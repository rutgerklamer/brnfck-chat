// What the page shows of a running program's tape: read in the worker, sent to the page as small arrays.
// Reading never changes a cell, so the program runs exactly as it would without it.
(function (root) {
  'use strict';

  // The tape in `cols` columns: a column is 1 when one of `per` cells sampled over it is not zero.
  function fill(tape, size, cols, per = 8) {
    const out = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor(c * size / cols), span = Math.max(1, Math.floor((c + 1) * size / cols) - a);
      for (let k = 0; k < per; k++) if (tape[a + Math.floor((k + 0.5) * span / per)] !== 0) { out[c] = 1; break; }
    }
    return out;
  }

  // How large a key is: the root mean square of its kv numbers (signed 32-bit cells, read with `| 0`; about -130..130).
  function keySize(tape, from, kv) {
    let sum = 0;
    for (let i = 0; i < kv; i++) { const v = tape[from + i] | 0; sum += v * v; }
    return Math.sqrt(sum / kv);
  }

  // The memory slots per layer and position. w.ends: per layer the cell after slot 0 (slot p ends p * size left of it);
  // u, ks: flag "in use" and key, counted back from a slot's end. shade: key size 0..1 within its layer.
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
