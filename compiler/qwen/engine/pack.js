'use strict';

// The byte stream the engine reads before the prompt, written piece by piece.

const fs = require('fs');

function packWeights(shape, net, layout, sink) {
  const { dim, hidden, heads, kvHeads, headSize: hs } = shape, kv = kvHeads * hs, share = heads / kvHeads;
  const { OFFW, OFFE } = layout, CH = layout.chunkRows, nL = net.layers.length;
  // query heads in engine order: head 0 of every key/value group first, then head 1, ... (model head g * share + s)
  const perm = (j) => { const s = Math.floor(j / kv), g = Math.floor((j % kv) / hs), i = j % hs; return (g * share + s) * hs + i; };
  const L = net.layers, E = net.emb;
  const value = {
    emb: (l, r, c) => E[r * dim + (dim - 1 - c)] + OFFE,
    wcls: (l, r, c) => E[(l * CH + r) * dim + c] + OFFE,
    qkv: (l, r, c) => OFFW + (r < dim ? L[l].wq.w[perm(r) * dim + c] : r < dim + kv ? L[l].wk.w[(r - dim) * dim + c] : L[l].wv.w[(r - dim - kv) * dim + c]),
    o: (l, r, c) => OFFW + L[l].wo.w[r * dim + perm(c)],
    w13: (l, r, c) => OFFW + (r < hidden ? L[l].w1.w[r * dim + c] : L[l].w3.w[(r - hidden) * dim + c]),
    w2: (l, r, c) => OFFW + L[l].w2.w[r * hidden + c],
  };
  const strip = {
    gainFirst: () => (i) => L[0].g1[i],
    gainNext: (l) => (i) => (l + 1 < nL ? L[l + 1].g1[i] : net.gFinal[i]),
    gainFfn: (l) => (i) => L[l].g2[i],
    drQkv: (l) => (i) => (i < dim ? L[l].wq.d[perm(i)] : i < dim + kv ? L[l].wk.d[i - dim] : L[l].wv.d[i - dim - kv]),
    drO: (l) => (i) => L[l].wo.d[i], dr1: (l) => (i) => L[l].w1.d[i], dr3: (l) => (i) => L[l].w3.d[i], dr2: (l) => (i) => L[l].w2.d[i],
    bias: (l) => (i) => (i < dim ? L[l].bq[perm(i)] : i < dim + kv ? L[l].bk[i - dim] : L[l].bv[i - dim - kv]),
  };
  const buf = new Uint8Array(1 << 22);
  let n = 0, total = 0;
  const flush = () => { sink(buf.subarray(0, n)); total += n; n = 0; };
  const put = (b) => { if (n === buf.length) flush(); buf[n++] = b; };
  for (const e of layout.plan) {
    if (e.type === 'cell') {
      if (e.name !== 'np') throw new Error('unknown cell ' + e.name);
      put(net.prefix.n);
    } else if (e.type === 'slots') {
      const pre = net.prefix, K = pre.k[e.layer], V = pre.v[e.layer];
      put(pre.n);
      for (let i = 0; i < pre.n * kv; i++) for (const v of [K[i] + 32768, V[i] + 32768]) { if (v < 0 || v > 65535) throw new Error('prefix value out of range'); put(v & 255); put(v >> 8); }
    } else if (e.type === 'strip') {
      const get = strip[e.name](e.layer), lim = 2 ** (8 * e.bytes);
      for (let i = 0; i < e.n; i++) {
        let v = get(i) + e.offset;
        if (e.bytes === 4 && e.offset === 0) v = v >>> 0;      // two's complement
        if (!(v >= 0 && v < lim)) throw new Error(`${e.name}: value ${v} does not fit ${e.bytes} byte(s)`);
        for (let b = 0; b < e.bytes; b++) { put(v % 256); v = Math.floor(v / 256); }
      }
    } else {
      const get = value[e.name], lim = 2 ** (8 * e.bytes), l = e.layer, B = e.bytes;
      for (let c = e.C - 1; c >= 0; c--) {
        if (n + e.R * B > buf.length) flush();
        for (let r = e.R - 1; r >= 0; r--) {
          const v = get(l, r, c);
          if (v < 1 || v >= lim) throw new Error(`${e.name}: value ${v} out of range`);
          buf[n++] = v & 255;
          if (B > 1) buf[n++] = (v >> 8) & 255;
          if (B > 2) buf[n++] = v >> 16;
        }
      }
    }
  }
  flush();
  return total;
}

function packToFile(shape, net, layout, file) {
  const fd = fs.openSync(file, 'w');
  const total = packWeights(shape, net, layout, (b) => fs.writeSync(fd, b));
  fs.closeSync(fd);
  return total;
}

// The number of bytes of the stream, from the plan alone (no weights needed): np prefix positions of kvDim keys and values.
const streamBytes = (layout, np, kvDim) => layout.plan.reduce((s, e) => s + (e.type === 'cell' ? 1 : e.type === 'strip' ? e.n * e.bytes : e.type === 'mat' ? e.R * e.C * e.bytes : 1 + np * kvDim * 4), 0);

module.exports = { packToFile, streamBytes };
