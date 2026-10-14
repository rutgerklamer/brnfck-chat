#!/usr/bin/env node
// How deep the loops are nested along a program: the data of the map layout "Skyline".
//   node tools/map-data/depth.js          all three programs
//   node tools/map-data/depth.js 0.5b     one of small, 0.5b, 1.5b
'use strict';
const fs = require('fs');
const path = require('path');
const { modelOf, IDS } = require('./models');

const BINS = 4096, FINE = 16384;
for (const id of process.argv[2] ? [process.argv[2]] : IDS) {
  const M = modelOf(id), total = M.meta.programBytes, from = M.meta.writerBytes, per = total / BINS, fper = (total - from) / FINE;
  const max = new Uint8Array(BINS), fine = new Uint8Array(FINE), fd = fs.openSync(M.file, 'r'), buf = Buffer.allocUnsafe(1 << 24);
  let depth = 0, deepest = 0, pos = 0, t0 = Date.now(), cb = 0, cEdge = 0, fb = -1, fEdge = from;
  for (;;) {
    const n = fs.readSync(fd, buf, 0, buf.length, pos); if (!n) break;
    for (let i = 0; i < n; i++) {
      const c = buf[i], d = pos + i;
      if (d >= cEdge) { cb = Math.min(BINS - 1, Math.floor(d / per)); cEdge = (cb + 1) * per; if (depth > max[cb]) max[cb] = depth; }
      if (d >= fEdge) { fb = Math.min(FINE - 1, Math.floor((d - from) / fper)); fEdge = from + (fb + 1) * fper; if (depth > fine[fb]) fine[fb] = depth; }
      if (c === 91) { depth++; if (depth > deepest) deepest = depth; if (depth > max[cb]) max[cb] = depth; if (fb >= 0 && depth > fine[fb]) fine[fb] = depth; } else if (c === 93) depth--;
    }
    pos += n;
  }
  fs.closeSync(fd);
  if (pos !== total || depth !== 0) throw new Error(id + ': read ' + pos + ' of ' + total + ' characters, depth at the end ' + depth);
  const out = { made: 'tools/map-data/depth.js', model: id, bins: BINS, per, max: [...max], engine: { from, bins: FINE, per: fper, max: [...fine] }, deepest };
  fs.writeFileSync(path.join(M.dir, 'depth.json'), JSON.stringify(out));
  console.log(id + ': deepest nesting ' + deepest + ', ' + fs.statSync(path.join(M.dir, 'depth.json')).size + ' bytes, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
