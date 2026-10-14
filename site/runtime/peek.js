// What the page shows of a running program's tape: read in the worker, sent to the page as small arrays.
// Reading never changes a cell, so the program runs exactly as it would without it.
(function (root) {
  'use strict';

  // The tape in `cols` columns. A column is 1 when one of `per` cells spread over it is not zero:
  // the parts the program has written light up, free cells and empty memory slots stay dark.
  function fill(tape, size, cols, per = 8) {
    const out = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor(c * size / cols), span = Math.max(1, Math.floor((c + 1) * size / cols) - a);
      for (let k = 0; k < per; k++) if (tape[a + Math.floor((k + 0.5) * span / per)] !== 0) { out[c] = 1; break; }
    }
    return out;
  }

  // How large a key is: the root of the mean square of its kv numbers. A cell holds a whole number
  // with a sign as 32 bits (`| 0` reads it); the numbers in these keys lie between about -130 and 130.
  function keySize(tape, from, kv) {
    let sum = 0;
    for (let i = 0; i < kv; i++) { const v = tape[from + i] | 0; sum += v * v; }
    return Math.sqrt(sum / kv);
  }

  // The memory slots: one per position, in every layer. w (from the page):
  //   ends: per layer, the cell just after slot 0; slot p ends `size` cells further left per position
  //   positions, size; u, ks: where the flag "in use" and the key lie, counted back from a slot's end; kv: numbers in a key
  // shade: the size of the slot's key from 0 to 1, against the smallest and largest key of the same layer
  function slots(tape, w) {
    const L = w.ends.length, P = w.positions, used = new Uint8Array(L * P), shade = new Float32Array(L * P);
    for (let l = 0; l < L; l++) {
      let lo = Infinity, hi = -Infinity;
      for (let p = 0; p < P; p++) {
        const end = w.ends[l] - p * w.size;
        if (tape[end - w.u - 1] === 0) continue;
        const s = keySize(tape, end - w.ks - w.kv, w.kv);
        used[l * P + p] = 1; shade[l * P + p] = s;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      for (let p = 0; p < P; p++) if (used[l * P + p]) shade[l * P + p] = hi > lo ? (shade[l * P + p] - lo) / (hi - lo) : 1;
    }
    return { used, shade };
  }

  root.Peek = { fill, slots };
})(self);
