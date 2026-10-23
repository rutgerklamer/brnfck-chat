#!/usr/bin/env node
// Map data of the four training programs (compiler/train): program text, writer.json, engine.json, tiles and depth.json.
//   node tools/map-data/train.js [train-bigram|train-mlp|train-attn|train-shakespeare]        (default: all four)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { modelOf, DEFS, ROOT, num } = require('./models');
const S = require('../../compiler/train/spec');
const { Gen, layout } = require('../../compiler/train/gen');

const ids = process.argv[2] ? [process.argv[2]] : Object.keys(DEFS).filter((id) => DEFS[id].train);
for (const id of ids) {
  const d = DEFS[id];
  if (!d || !d.train) throw new Error(`not a training program: ${id}`);
  const t0 = Date.now(), m = S.MODELS[d.train], L = layout(m);
  const engine = new Gen(m, { child: true }).childEngine();
  const tr = new Gen(m).trainer(engine), src = tr.src, chars = src.length, writer = tr.writerChars;

  // the program and its meta file, where the map tools look for them
  const file = path.join(ROOT, 'site', d.web);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src, 'latin1');
  const sha256 = crypto.createHash('sha256').update(src, 'latin1').digest('hex');
  fs.writeFileSync(file.replace(/\.bf$/, '.meta.json'), JSON.stringify({ name: d.label, programBytes: chars, writerBytes: writer, restBytes: chars - writer, tapeSize: L.tapeSize, sha256, deepAll: true }, null, 1));

  // what the program is made of
  let depth = 0, deepW = 0, deepE = 0, run = 0, longestLeft = 0;
  const commas = [], dots = [];
  for (let i = 0; i < chars; i++) {
    const c = src.charCodeAt(i);
    if (c === 91) { depth++; if (i < writer) deepW = Math.max(deepW, depth); else deepE = Math.max(deepE, depth); } else if (c === 93) depth--;
    else if (c === 44) commas.push(i); else if (c === 46) dots.push(i);
    if (c === 60) { run++; if (run > longestLeft) longestLeft = run; } else run = 0;
  }
  const parts = tr.parts.slice(0, -1).map(([name, from], i) => [name, from, tr.parts[i + 1][1]]);
  const step = parts.find((p) => p[0] === 'print-step'), dot = dots.find((x) => x >= step[1]);
  const M = modelOf(id), dir = M.dir;
  // V: how many characters it knows; text: what it reads (names or shakespeare), unit: what the map calls one of them
  const info = { kind: m.kind, parameters: S.paramsOf(m).total, batch: m.batch, epochs: m.epochs, context: m.T || m.ctx, hidden: m.hidden || 0, dk: m.dk || 0, V: m.chars.length, T: L.T, text: m.text || 'names', unit: m.text === 'shakespeare' ? 'character' : 'letter', engine: engine.length };
  fs.writeFileSync(path.join(dir, 'writer.json'), JSON.stringify({
    made: 'tools/map-data/train.js', modelName: d.label, file: d.web, family: 'train', train: info,
    program: { chars, writer, engine: chars - writer, tape: L.tapeSize, sha256 }, parts,
    stretches: [], regions: [], samples: [], finalMove: { from: 0, chars: 0 }, blocks: { record: 32, radKeys: [] }, encoder: { blocks: 0 },
    counts: { maxDepthWriter: deepW, maxDepthEngine: deepE, longestRunLeft: longestLeft, commas: commas.length, dots: dots.length },
  }));
  fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify({
    made: 'tools/map-data/train.js', family: 'train', from: writer, chars: chars - writer, comma: commas[0], commaAll: commas, dot, sections: [], marks: [], model: { name: d.label },
  }));
  // no blocks: these programs write their few numbers cell by cell
  fs.writeFileSync(path.join(dir, 'blocks.bin'), Buffer.alloc(0));
  for (const tool of ['tiles.js', 'depth.js']) execFileSync(process.execPath, [path.join(__dirname, tool), id], { stdio: 'inherit' });
  console.log(`${id}: ${num(chars)} characters, ${parts.length} parts, deepest ${Math.max(deepW, deepE)}, ${commas.length} commas, ${num(dots.length)} full stops [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
}
