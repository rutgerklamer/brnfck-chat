// The pieces of a pattern page as HTML text.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n) => (n === null || n === undefined ? '' : Math.round(n).toLocaleString('en-US').replace('-', '−'));
  const shown = (text) => text.replace(/[\x00-\x1f\x7f-\xff]/g, (c) => (c === '\n' ? '↵' : '·'));

  // The values of a case as words: "x = 3; y = 4".
  function valuesText(v, vals) {
    const fields = [...(v.consts || []), ...(v.vars || [])];
    if (!fields.length) return 'no values to choose';
    return fields.map((f) => {
      const x = vals[f.id];
      const short = f.label.length <= 12 ? f.label : f.id;
      if (f.type === 'list') return short + ' = ' + (x.length > 6 ? x.slice(0, 5).join(', ') + ', … (' + x.length + ')' : x.join(', ') || 'none');
      if (f.type === 'text') return short + ' = "' + x + '"';
      if (f.type === 'choice') return short + ' = ' + (f.options.find((o) => String(o[0]) === String(x)) || [0, x])[1];
      return short + ' = ' + fmt(x);
    }).join('; ');
  }

  function barsHTML(rows) {
    const max = Math.max(1, ...rows.map((r) => r.value || 0));
    let h = '<div class="bars">';
    for (const r of rows) {
      const w = r.value === null ? 100 : Math.max(0.6, (100 * r.value) / max);
      h += '<span class="lab">' + esc(r.label) + '</span><div><div class="bar ' + (r.value === null ? 'range' : r.kind === 'fast' ? 'b2' : 'ink') + '" style="width:' + w.toFixed(2) + '%"></div></div><span>'
        + (r.value === null ? 'more than ' + fmt(r.cut) : fmt(r.value)) + '</span>';
    }
    return h + '</div>';
  }

  function ratioText(plain, fast) {
    if (plain === null || !fast) return '';
    const q = plain / fast;
    if (q < 1.5) return 'Folding gains nothing here: nothing in this program is a flat loop.';
    return 'The optimising interpreter needs ' + (q >= 20 ? fmt(q) : q.toFixed(1)) + ' times fewer steps.';
  }

  return { esc, fmt, shown, valuesText, barsHTML, ratioText };
});
