'use strict';

// The byte stream the engine reads before the prompt, written piece by piece.

const fs = require('fs');

function packWeights(m, net, layout, sink) {
  const { dim, hidden, heads, kvHeads, headSize: hs } = m, kv = kvHeads * hs, share = heads / kvHeads;
  const OFFW = 2 ** (net.cfg.weightBits - 1), OFFX = 2 ** (net.cfg.xBits - 1) + 1, CH = layout.chunkRows;
  const perm = (j) => { const s = Math.floor(j / kv), g = Math.floor((j % kv) / hs), i = j % hs; return (g * share + s) * hs + i; };
  const L = net.layers;
  const value = {
    emb: (l, r, c) => net.emb[r * dim + (dim - 1 - c)] + OFFX,
    qkv: (l, r, c) => OFFW + (r < dim ? L[l].wq.w[perm(r) * dim + c] : r < dim + kv ? L[l].wk.w[(r - dim) * dim + c] : L[l].wv.w[(r - dim - kv) * dim + c]),
    o: (l, r, c) => OFFW + L[l].wo.w[r * dim + perm(c)],
    w13: (l, r, c) => OFFW + (r < hidden ? L[l].w1.w[r * dim + c] : L[l].w3.w[(r - hidden) * dim + c]),
    w2: (l, r, c) => OFFW + L[l].w2.w[r * hidden + c],
    wcls: (l, r, c) => OFFW + net.wcls.w[(l * CH + r) * dim + c],
  };
  const cell = {
    dq: (l) => L[l].wq.d, dk: (l) => L[l].wk.d, dv: (l) => L[l].wv.d, do: (l) => L[l].wo.d, d1: (l) => L[l].w1.d, d3: (l) => L[l].w3.d, d2: (l) => L[l].w2.d,
    eo: (l) => L[l].eo, e2: (l) => L[l].e2, dc: () => net.wcls.d, np: () => net.prefix.n,
  };
  const buf = new Uint8Array(1 << 20);
  let n = 0, total = 0;
  const put = (b) => { if (n === buf.length) { sink(buf); total += n; n = 0; } buf[n++] = b; };
  for (const e of layout.plan) {
    if (e.type === 'cell') {
      const v = cell[e.name](e.layer);
      if (!(v >= 0 && v <= 255)) throw new Error(`${e.name} = ${v} does not fit a byte`);
      put(v);
    } else if (e.type === 'slots') {
      const pre = net.prefix, K = pre.k[e.layer], V = pre.v[e.layer];
      put(pre.n);
      for (let i = 0; i < pre.n * kv; i++) for (const v of [K[i] + 32768, V[i] + 32768]) { put(v & 255); put(v >> 8); }
    } else {
      const get = value[e.name], lim = e.bytes === 3 ? 2 ** net.cfg.xBits : 2 * OFFW - 1;
      for (let c = e.C - 1; c >= 0; c--) {
        for (let r = e.R - 1; r >= 0; r--) {
          const v = get(e.layer, r, c);
          if (v < 1 || v > lim) throw new Error(`${e.name}: value out of range`);
          put(v & 255); put((v >> 8) & 255);
          if (e.bytes === 3) put(v >> 16);
        }
      }
    }
  }
  sink(buf.subarray(0, n));
  return total + n;
}

function packToFile(m, net, layout, file) {
  const fd = fs.openSync(file, 'w');
  const total = packWeights(m, net, layout, (b) => fs.writeSync(fd, b));
  fs.closeSync(fd);
  return total;
}

module.exports = { packToFile };
