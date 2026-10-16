#!/usr/bin/env node
// Where the only comma and the only full stop of a program are: the data of the figure "One comma,
// one full stop" on the page how/. For each of the two it keeps the section of the engine around it,
// the mix of commands along the program, the engine and that section, how many loops are open at it,
// and the text right around it.
//   node tools/map-data/stops.js          all four programs
//   node tools/map-data/stops.js small    one of small, 0.5b, 1.5b, 0.8b
'use strict';
const fs = require('fs');
const path = require('path');
const { modelOf, IDS } = require('./models');

const BINS = 512, AROUND = 160;
const COMMANDS = '+-<>[].,';
const index = new Int8Array(256).fill(-1);
for (let i = 0; i < 8; i++) index[COMMANDS.charCodeAt(i)] = i;
// the mix of commands in BINS equal stretches of a text: for every stretch eight shares that add up to
// about 255, as one string of bytes in base64
function mix(text) {
  const n = new Float64Array(BINS * 8), per = text.length / BINS;
  for (let i = 0; i < text.length; i++) { const k = index[text.charCodeAt(i)]; if (k >= 0) n[Math.min(BINS - 1, Math.floor(i / per)) * 8 + k]++; }
  return pack(n);
}
function pack(n) {
  const out = Buffer.alloc(BINS * 8);
  for (let b = 0; b < BINS; b++) { let t = 0; for (let k = 0; k < 8; k++) t += n[b * 8 + k]; for (let k = 0; k < 8; k++) out[b * 8 + k] = t ? Math.round(255 * n[b * 8 + k] / t) : 0; }
  return out.toString('base64');
}
for (const id of process.argv[2] ? [process.argv[2]] : IDS) {
  const M = modelOf(id), total = M.meta.programBytes, writer = M.meta.writerBytes;
  const E = JSON.parse(fs.readFileSync(path.join(M.dir, 'engine.json'), 'utf8'));
  const W = JSON.parse(fs.readFileSync(path.join(M.dir, 'writer.json'), 'utf8'));
  // the engine, read from the file; it holds the only comma and the only full stop
  const fd = fs.openSync(M.file, 'r'), buf = Buffer.alloc(total - writer);
  if (fs.readSync(fd, buf, 0, buf.length, writer) !== buf.length) throw new Error(id + ': the engine could not be read');
  fs.closeSync(fd);
  const engine = buf.toString('latin1'), find = (ch) => {
    const a = engine.indexOf(ch);
    if (a < 0 || engine.indexOf(ch, a + 1) >= 0) throw new Error(id + ': the engine does not hold exactly one ' + ch);
    return writer + a;
  };
  if (W.counts.writer[6] || W.counts.writer[7]) throw new Error(id + ': the writing part holds a comma or a full stop');
  // the whole program: the mix of writer.json, which counted every character, in BINS stretches
  const P = W.profile, whole = new Float64Array(BINS * 8);
  for (let b = 0; b < P.bins; b++) for (let k = 0; k < 8; k++) whole[Math.min(BINS - 1, Math.floor(b * BINS / P.bins)) * 8 + COMMANDS.indexOf(W.counts.order[k])] += P.shares[b * 8 + k];
  const stops = [',', '.'].map((ch) => {
    const at = find(ch), s = E.sections.find((x) => x.from <= at && at < x.to);
    if (at !== (ch === ',' ? E.comma : E.dot)) throw new Error(id + ': ' + ch + ' is not where engine.json has it');
    const text = engine.slice(s.from - writer, s.to - writer);
    // how many loops are open at it: the engine starts outside every loop
    let depth = 0; for (let i = 0; i < at - writer; i++) { const c = engine.charCodeAt(i); if (c === 91) depth++; else if (c === 93) depth--; }
    return { command: ch, at, depth, section: s.id, from: s.from, to: s.to, mix: mix(text), before: engine.slice(Math.max(0, at - writer - AROUND), at - writer), after: engine.slice(at - writer + 1, at - writer + 1 + AROUND) };
  });
  const out = { made: 'tools/map-data/stops.js', model: id, label: M.label, chars: total, writer, bins: BINS, order: COMMANDS, program: pack(whole), engine: mix(engine), stops };
  fs.writeFileSync(path.join(M.dir, 'stops.json'), JSON.stringify(out));
  console.log(id + ': comma at ' + stops[0].at + ' (' + stops[0].section + '), full stop at ' + stops[1].at + ' (' + stops[1].section + '), ' + fs.statSync(path.join(M.dir, 'stops.json')).size + ' bytes');
}
