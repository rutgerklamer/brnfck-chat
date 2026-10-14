// Put a small, runnable brainfuck playground in any page of this site: load this script, and every element with class "bf-play" (the program is its text or data-code; data-input, data-names, data-rows and so on set the rest) becomes one.
(function () {
  'use strict';
  var base = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;
  var KEYS = ['input', 'title', 'rows', 'speed', 'explain', 'link', 'bits', 'size', 'overflow', 'edge', 'eof', 'bp'];
  function query(o) {
    var p = new URLSearchParams();
    p.set('code', o.code || '');
    KEYS.forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== '') p.set(k, o[k]); });
    if (o.names) { var n = typeof o.names === 'string' ? o.names : Object.keys(o.names).map(function (k) { return k + ':' + o.names[k]; }).join(','); if (n) p.set('names', n); }
    if (o.readonly) p.set('readonly', '1');
    if (o.autorun) p.set('autorun', '1');
    return p.toString();
  }
  function url(o) { return base + 'embed.html?' + query(o); }
  function playgroundUrl(o) { var c = {}; for (var k in o) if (['title', 'rows', 'speed', 'explain', 'link', 'readonly', 'autorun'].indexOf(k) < 0) c[k] = o[k]; return base + '?' + query(c); }
  function mount(node, o) {
    var f = document.createElement('iframe');
    f.src = url(o); f.className = 'bf-play-frame'; f.loading = 'lazy';
    f.title = 'Runnable brainfuck' + (o.title ? ': ' + o.title : ' program');
    f.style.cssText = 'display:block;width:100%;height:' + (22 + 5.5 * (+o.rows || 1)) + 'rem;border:0;margin:0 0 1rem;color-scheme:light dark';
    f.setAttribute('allow', 'clipboard-write');
    node.replaceWith(f);
    return f;
  }
  function scan(root) {
    var list = (root || document).querySelectorAll('.bf-play:not(iframe)');
    Array.prototype.forEach.call(list, function (n) {
      var d = n.dataset, o = { code: d.code !== undefined ? d.code : n.textContent.replace(/^\n+|\s+$/g, '') };
      KEYS.concat(['names']).forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; });
      if (d.readonly !== undefined) o.readonly = true;
      if (d.autorun !== undefined) o.autorun = true;
      mount(n, o);
    });
  }
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'bf-embed-height') return;
    var frames = document.querySelectorAll('iframe.bf-play-frame');
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(120, Math.min(4000, +e.data.height || 0)) + 'px';
  });
  window.BFPlay = { mount: mount, url: url, playgroundUrl: playgroundUrl, scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); }); else scan();
})();
