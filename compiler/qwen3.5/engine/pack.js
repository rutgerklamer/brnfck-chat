'use strict';

// The byte stream the engine reads before the prompt (in the order of layout.plan), and the prompt itself.

const fs = require('fs');

// The value of every entry of the plan: matrices (l, r, c), strips (l) => (i), and those of the token mixers.
function valuesOf(arch, net, layout, kinds) {
  const { dim, hidden } = arch, { OFFW, OFFE } = layout, CH = layout.chunkRows, L = net.layers, E = net.emb, nL = L.length;
  const mats = {
    emb: (l, r, c) => E[r * dim + (dim - 1 - c)] + OFFE,
    wcls: (l, r, c) => E[(l * CH + r) * dim + c] + OFFE,
    w13: (l, r, c) => OFFW + (r < hidden ? L[l].w1.w[r * dim + c] : L[l].w3.w[(r - hidden) * dim + c]),
    w2: (l, r, c) => OFFW + L[l].w2.w[r * hidden + c],
  };
  const strips = {
    gainFirst: () => (i) => L[0].g1[i],
    gainNext: (l) => (i) => (l + 1 < nL ? L[l + 1].g1[i] : net.gFinal[i]),
    gainFfn: (l) => (i) => L[l].g2[i],
    dr1: (l) => (i) => L[l].w1.d[i], dr3: (l) => (i) => L[l].w3.d[i], dr2: (l) => (i) => L[l].w2.d[i],
  };
  for (const m of new Set(Object.values(kinds))) {
    const v = m.values(arch, net, layout);
    Object.assign(mats, v.mats || {}); Object.assign(strips, v.strips || {});
  }
  return { mats, strips };
}

function packWeights(arch, net, layout, kinds, sink) {
  const { mats, strips } = valuesOf(arch, net, layout, kinds);
  const buf = new Uint8Array(1 << 22);
  let n = 0, total = 0;
  const flush = () => { sink(buf.subarray(0, n)); total += n; n = 0; };
  const put = (b) => { if (n === buf.length) flush(); buf[n++] = b; };
  for (const e of layout.plan) {
    if (e.type === 'strip') {
      if (!strips[e.name]) throw new Error('no values for strip ' + e.name);
      const get = strips[e.name](e.layer), lim = 2 ** (8 * e.bytes);
      for (let i = 0; i < e.n; i++) {
        let v = get(i) + e.offset;
        if (e.bytes === 4 && e.offset === 0) v = v >>> 0;      // two's complement
        if (!(v >= 0 && v < lim)) throw new Error(`${e.name}: value ${v} does not fit ${e.bytes} byte(s)`);
        for (let b = 0; b < e.bytes; b++) { put(v % 256); v = Math.floor(v / 256); }
      }
    } else if (e.type === 'mat') {
      const get = mats[e.name], lim = 2 ** (8 * e.bytes), l = e.layer, B = e.bytes;
      if (!get) throw new Error('no values for matrix ' + e.name);
      for (let c = e.C - 1; c >= 0; c--) {
        if (n + e.R * B > buf.length) flush();
        for (let r = e.R - 1; r >= 0; r--) {
          const v = get(l, r, c);
          if (!(v >= 1 && v < lim)) throw new Error(`${e.name} layer ${l} row ${r} column ${c}: value ${v} out of range`);
          buf[n++] = v & 255;
          if (B > 1) buf[n++] = (v >> 8) & 255;
          if (B > 2) buf[n++] = v >> 16;
        }
      }
    } else throw new Error('unknown plan entry ' + e.type);
  }
  flush();
  return total;
}

function packToArray(arch, net, layout, kinds) {
  const parts = [];
  packWeights(arch, net, layout, kinds, (b) => parts.push(Uint8Array.from(b)));
  return Buffer.concat(parts);
}
function packToFile(arch, net, layout, kinds, file) {
  const fd = fs.openSync(file, 'w');
  const total = packWeights(arch, net, layout, kinds, (b) => fs.writeSync(fd, b));
  fs.closeSync(fd);
  return total;
}
const streamBytes = (layout) => layout.plan.reduce((s, e) => s + (e.type === 'strip' ? e.n * e.bytes : e.R * e.C * e.bytes), 0);

// The prompt: the number of positions to run, the number of ids, the ids (3 bytes, low byte first).
function packPrompt(ids, positions) {
  if (positions > 255 || ids.length > 255) throw new Error('at most 255 positions');
  return Uint8Array.from([positions, ids.length, ...ids.flatMap((id) => [id & 255, (id >> 8) & 255, id >> 16])]);
}
// What the engine printed: 3 bytes per id.
const unpackIds = (bytes) => Array.from({ length: Math.floor(bytes.length / 3) }, (_, i) => bytes[3 * i] + 256 * bytes[3 * i + 1] + 65536 * bytes[3 * i + 2]);

module.exports = { packWeights, packToArray, packToFile, streamBytes, packPrompt, unpackIds };
