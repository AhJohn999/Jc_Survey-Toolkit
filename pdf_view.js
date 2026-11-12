// A PDF viewer for the web version (iPhone / iPad), used by lib/platform/pio_web.dart.
// iOS will not show a PDF from a Home Screen web app, it only downloads it, so the app
// draws the pages itself with pdf.js (web/pdfjs, Apache 2.0). Everything is served by
// the app, so it works offline.
//
//   window.jcsShowPdf(bytes: Uint8Array, fileName: string)
//
// Full screen on top of the app: Close, zoom - / +, and Share (Save to Files, Mail...).
(function () {
  'use strict';
  var pdfjsPromise = null;

  function loadPdfJs() {
    if (!pdfjsPromise) {
      var base = new URL('pdfjs/', document.baseURI).href;
      pdfjsPromise = import(base + 'pdf.min.mjs').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
        return lib;
      });
      pdfjsPromise.catch(function () { pdfjsPromise = null; });
    }
    return pdfjsPromise;
  }

  var CSS =
    '#jcs-pdf{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;' +
    'background:#2a2e35;font:15px -apple-system,system-ui,sans-serif;color:#fff;' +
    '-webkit-user-select:none;user-select:none}' +
    '#jcs-pdf .bar{display:flex;align-items:center;gap:6px;padding:8px 8px;' +
    'padding-top:calc(8px + env(safe-area-inset-top));background:#0F1216;flex:none}' +
    '#jcs-pdf .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    'font-weight:600;padding:0 6px}' +
    '#jcs-pdf button{min-width:44px;height:44px;border:0;border-radius:10px;background:#1f252d;' +
    'color:#fff;font:600 15px -apple-system,system-ui,sans-serif;padding:0 12px;cursor:pointer}' +
    '#jcs-pdf button:active{background:#33404d}' +
    '#jcs-pdf .pages{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 0 32px;' +
    'padding-bottom:calc(32px + env(safe-area-inset-bottom))}' +
    '#jcs-pdf .page{margin:0 auto 12px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.4);position:relative}' +
    '#jcs-pdf .page canvas{display:block;width:100%;height:100%}' +
    '#jcs-pdf .msg{padding:32px 20px;text-align:center;color:#c9d1db}' +
    '#jcs-pdf .count{color:#c9d1db;font-size:13px;padding:0 4px;white-space:nowrap}';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function share(bytes, name) {
    var file = new File([bytes], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  window.jcsShowPdf = function (bytes, name) {
    var old = document.getElementById('jcs-pdf');
    if (old) old.remove();
    if (!document.getElementById('jcs-pdf-css')) {
      var st = el('style'); st.id = 'jcs-pdf-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var copy = new Uint8Array(bytes); // pdf.js takes ownership of what it is given

    var root = el('div'); root.id = 'jcs-pdf';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', name);
    var bar = el('div', 'bar');
    var close = el('button', null, 'Close');
    var title = el('div', 'name', name);
    var count = el('div', 'count', '');
    var minus = el('button', null, '−'); minus.setAttribute('aria-label', 'Zoom out');
    var plus = el('button', null, '+'); plus.setAttribute('aria-label', 'Zoom in');
    var shareBtn = el('button', null, 'Share');
    shareBtn.setAttribute('aria-label', 'Share or save the PDF');
    bar.append(close, title, count, minus, plus, shareBtn);
    var pages = el('div', 'pages');
    pages.appendChild(el('div', 'msg', 'Opening…'));
    root.append(bar, pages);
    document.body.appendChild(root);

    var doc = null, task = null, zoom = 1, observer = null, closed = false;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

    function finish() {
      closed = true;
      if (observer) observer.disconnect();
      if (task) task.destroy().catch(function () {}); // frees the document and its worker
      root.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') finish(); }
    document.addEventListener('keydown', onKey);
    close.onclick = finish;
    shareBtn.onclick = function () { share(bytes, name); };

    function layout() {
      if (!doc || closed) return;
      var keepRatio = pages.scrollHeight ? pages.scrollTop / pages.scrollHeight : 0;
      if (observer) observer.disconnect();
      pages.textContent = '';
      var avail = pages.clientWidth - 24;
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) draw(en.target); });
      }, { root: pages, rootMargin: '600px 0px' });
      var jobs = [];
      for (var i = 1; i <= doc.numPages; i++) jobs.push(doc.getPage(i));
      Promise.all(jobs).then(function (list) {
        if (closed) return;
        list.forEach(function (page) {
          var v = page.getViewport({ scale: 1 });
          var cssW = avail * zoom, cssH = cssW * v.height / v.width;
          var box = el('div', 'page');
          box.style.width = cssW + 'px'; box.style.height = cssH + 'px';
          box._page = page; box._cssW = cssW;
          pages.appendChild(box);
          observer.observe(box);
        });
        pages.scrollTop = keepRatio * pages.scrollHeight;
      });
      count.textContent = doc.numPages + (doc.numPages === 1 ? ' page' : ' pages');
    }

    function draw(box) {
      if (box._drawn || closed) return;
      box._drawn = true;
      var page = box._page;
      var v1 = page.getViewport({ scale: 1 });
      var scale = box._cssW / v1.width * dpr;
      // Keep each page within what iOS allows for one picture.
      var maxPixels = 16e6, px = v1.width * v1.height * scale * scale;
      if (px > maxPixels) scale *= Math.sqrt(maxPixels / px);
      var v = page.getViewport({ scale: scale });
      var c = document.createElement('canvas');
      c.width = Math.floor(v.width); c.height = Math.floor(v.height);
      box.appendChild(c);
      page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise.catch(function () {});
    }

    minus.onclick = function () { if (zoom > 0.5) { zoom = Math.max(0.5, zoom / 1.25); layout(); } };
    plus.onclick = function () { if (zoom < 4) { zoom = Math.min(4, zoom * 1.25); layout(); } };
    window.addEventListener('resize', function onResize() {
      if (closed) { window.removeEventListener('resize', onResize); return; }
      layout();
    });

    loadPdfJs()
      .then(function (lib) {
        task = lib.getDocument({ data: copy, isEvalSupported: false });
        return task.promise;
      })
      .then(function (d) {
        if (closed) return;
        doc = d; layout();
      })
      .catch(function (e) {
        pages.textContent = '';
        pages.appendChild(el('div', 'msg', 'This PDF could not be shown here. Use Share to open it in another app. (' + (e && e.message || e) + ')'));
      });
  };
})();
