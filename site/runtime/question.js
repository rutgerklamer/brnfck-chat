// The bytes a program reads: the question on one line, cut to fit, ended by a newline.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Question = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function questionBytes(text, maxBytes) {
    const line = String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    let bytes = new TextEncoder().encode(line);
    if (bytes.length > maxBytes) {
      let end = maxBytes;
      while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;      // not in the middle of a character
      bytes = bytes.subarray(0, end);
    }
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes);
    out[bytes.length] = 10;
    return out;
  }

  return { questionBytes };
});
