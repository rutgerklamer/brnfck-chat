'use strict';

// The threads of worker.js (which loads this file too for poolRows): each computes a share of the rows of y = W x.
// ctrl (Int32Array): 0 job number, 1 shares done, 2 matrix, 3 rows, 4 columns, 5 matrices received (all threads)

const POOL_LUT = new Float32Array(65536); // bfloat16 bits -> value
{ const bits = new Uint32Array(POOL_LUT.buffer); for (let i = 0; i < 65536; i++) bits[i] = i << 16; }

// Rows of share `me` of `count`. A bfloat16 matrix is summed as float.js matvec does (four running sums, in that
// order), so the result is the same to the last bit; a whole-number matrix (deltanet.js) has a doubling per row.
function poolRows(ctrl, X, Y, mats, me, count) {
  const { W, d } = mats[ctrl[2]], rows = ctrl[3], cols = ctrl[4], c4 = cols & ~3;
  const per = Math.ceil(rows / count), from = me * per, to = Math.min(rows, from + per);
  if (d) {
    for (let r = from, at = from * cols; r < to; r++, at += cols) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
      for (; c < c4; c += 4) { s0 += W[at + c] * X[c]; s1 += W[at + c + 1] * X[c + 1]; s2 += W[at + c + 2] * X[c + 2]; s3 += W[at + c + 3] * X[c + 3]; }
      for (; c < cols; c++) s0 += W[at + c] * X[c];
      Y[r] = (s0 + s1 + s2 + s3) * 2 ** d[r]; // whole numbers: exact in any order
    }
  } else {
    const T = POOL_LUT;
    for (let r = from, at = from * cols; r < to; r++, at += cols) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
      for (; c < c4; c += 4) { s0 += T[W[at + c]] * X[c]; s1 += T[W[at + c + 1]] * X[c + 1]; s2 += T[W[at + c + 2]] * X[c + 2]; s3 += T[W[at + c + 3]] * X[c + 3]; }
      for (; c < cols; c++) s0 += T[W[at + c]] * X[c];
      Y[r] = s0 + s1 + s2 + s3;
    }
  }
}

if (self.name && self.name.startsWith('pool')) {
  let ctrl, X, Y, me, count;
  const mats = [];
  let job = 0;
  // Blocks between jobs (a wake-up through the event loop would cost more than most products); after 20 ms
  // without work it lets the messages in, which bring new matrices.
  const run = () => {
    for (;;) {
      if (Atomics.wait(ctrl, 0, job, 20) === 'timed-out') { setTimeout(run, 0); return; }
      job = Atomics.load(ctrl, 0);
      poolRows(ctrl, X, Y, mats, me, count);
      Atomics.add(ctrl, 1, 1); Atomics.notify(ctrl, 1);
    }
  };
  onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init') { ({ ctrl, X, Y, me, count } = m); job = Atomics.load(ctrl, 0); run(); }
    if (m.type === 'mat') { mats[m.id] = m; Atomics.add(ctrl, 5, 1); Atomics.notify(ctrl, 5); }
  };
}
