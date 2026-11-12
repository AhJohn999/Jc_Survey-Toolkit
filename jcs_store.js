// The app's file storage in the browser (IndexedDB). Used by lib/platform/pio_web.dart.
// Two stores, keyed by path: "meta" holds {s: size, m: modified time (ms)}, "data" the bytes.
// Every change is one database transaction, so a save is either fully done or not at all.
(function () {
  'use strict';
  var DB = 'jcsurvey_files', VERSION = 1, META = 'meta', DATA = 'data';
  var dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
        var req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error('Storage is busy in another tab')); };
      });
      dbPromise.catch(function () { dbPromise = null; }); // allow a later retry
    }
    return dbPromise;
  }

  // Runs fn(metaStore, dataStore, tx) in one transaction; resolves with what fn
  // put in box.value once the transaction has committed.
  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([META, DATA], mode);
        var box = { value: undefined };
        tx.oncomplete = function () { resolve(box.value); };
        tx.onerror = function () { reject(tx.error || new Error('Storage error')); };
        tx.onabort = function () { reject(tx.error || new Error('Storage write was cancelled (phone storage full?)')); };
        try { fn(tx.objectStore(META), tx.objectStore(DATA), box); } catch (e) { tx.abort(); reject(e); }
      });
    });
  }

  window.jcsStore = {
    loadIndex: function () {
      return run('readonly', function (meta, data, box) {
        var keys = [], sizes = [], times = [];
        var cur = meta.openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { keys.push(String(c.key)); sizes.push(c.value.s); times.push(c.value.m); c.continue(); }
          else box.value = { keys: keys, sizes: sizes, times: times };
        };
      });
    },
    read: function (key) {
      return run('readonly', function (meta, data, box) {
        var r = data.get(key);
        r.onsuccess = function () { box.value = r.result === undefined ? null : r.result; };
      });
    },
    put: function (key, bytes, mtime) {
      // Copy into a buffer of its own, so only these bytes are stored.
      var own = new Uint8Array(bytes);
      return run('readwrite', function (meta, data) {
        data.put(own, key);
        meta.put({ s: own.length, m: mtime }, key);
      });
    },
    del: function (key) {
      return run('readwrite', function (meta, data) { data.delete(key); meta.delete(key); });
    },
    move: function (from, to) {
      return run('readwrite', function (meta, data) {
        // Requests in one transaction finish in order, so m is done when d is.
        var m = meta.get(from), d = data.get(from);
        d.onsuccess = function () {
          if (d.result === undefined) return;
          data.put(d.result, to); data.delete(from);
          meta.put(m.result, to); meta.delete(from);
        };
      });
    },
    persist: function () {
      try {
        return navigator.storage && navigator.storage.persist ? navigator.storage.persist() : Promise.resolve(false);
      } catch (e) { return Promise.resolve(false); }
    }
  };
})();
