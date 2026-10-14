'use strict';
// The main numbers of the three programs side by side, from what the other scripts wrote: compare.json.
const fs = require('fs');
const path = require('path');
const { DEFS, IDS, DATA, num } = require('./models');

// bytes and files below a folder
function folder(dir) {
  let bytes = 0, files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = folder(p); bytes += s.bytes; files += s.files; } else { bytes += fs.statSync(p).size; files++; }
  }
  return { bytes, files };
}

const models = [];
for (const id of IDS) {
  const dir = path.join(DATA, id), read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const need = ['writer.json', 'engine.json', 'tiles.json', 'checks.json'].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (need.length) { console.log(`${id}: left out, missing ${need.join(', ')}`); continue; }
  const W = read('writer.json'), E = read('engine.json'), T = read('tiles.json'), C = read('checks.json');
  const all = W.counts.writer.map((v, i) => v + W.counts.engine[i]), eng = W.counts.engine;
  // cells of the tape and characters of the text, by kind of region
  const tapeKinds = {}, textKinds = {};
  for (const r of W.regions) tapeKinds[r.kind] = (tapeKinds[r.kind] || 0) + r.to - r.from;
  for (const [ri, from, to] of W.stretches) { const k = W.regions[ri].kind; textKinds[k] = (textKinds[k] || 0) + to - from; }
  textKinds.work = (textKinds.work || 0) + W.finalMove.chars;
  const cells = (kinds) => W.regions.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.rows * r.cols, 0);
  let steps = null;
  const names = fs.existsSync(path.join(dir, 'traces.json')) ? read('traces.json') : [];
  if (names.length) {
    const runs = names.map((n) => read(`trace-${n}.json`)), long = runs[runs.length - 1], first = runs[0], tot = long.positions.map((p) => p.total);
    const p24 = first.positions.find((p) => p.position === first.fixedPositions) || first.positions[0];
    steps = {
      question: long.question, runs: runs.length, complete: long.complete !== false, from: long.positions[0].position, to: long.positions[long.positions.length - 1].position, count: long.positions.length,
      first: tot[0], min: Math.min(...tot), max: Math.max(...tot), sections: first.sections, pos24: { position: p24.position, question: first.question, total: p24.total, steps: p24.steps },
    };
  }
  const disk = folder(dir), tilesDisk = folder(path.join(dir, 'tiles')), deepDisk = folder(path.join(dir, 'deep'));
  const a = E.model;
  models.push({
    id, label: DEFS[id].label, name: W.modelName || a.name, family: E.family, file: W.file, layers: a.layers, dim: a.dim, hidden: a.hidden, heads: a.heads, kvHeads: a.kvHeads, vocab: a.vocab, weightBits: a.weightBits,
    chars: W.program.chars, writer: W.program.writer, engine: W.program.engine, counts: { order: W.counts.order, all, engine: eng },
    engineLoops: eng[4], engineMoves: eng[2] + eng[3], engineOther: W.program.engine - eng[2] - eng[3], engineSections: E.sections.length, engineDepth: W.counts.maxDepthEngine,
    tape: W.program.tape, memoryBits: W.program.memoryBits || 32, nonZero: W.tape.nonZero, entropy: W.tape.entropyBitsPerCell, floor: W.tape.floorCharsAt3Bits, plainCounting: W.tape.plainCounting,
    blocks: W.encoder.blocks, matrixWeights: cells(E.family === 'qwen' ? ['qkv', 'o', 'w13', 'w2'] : ['qkv', 'o', 'w13', 'w2', 'cls']), tableCells: cells(['emb']), tapeKinds, textKinds,
    timing: { ...C.timing, writeSeconds: C.tapeRun ? C.tapeRun.seconds : null, log: C.from[0] },
    steps, order: T.order, side: T.side,
    data: { totalBytes: disk.bytes, files: disk.files, tiles: tilesDisk.files, tileBytes: tilesDisk.bytes, deepPieces: deepDisk.files, deepBytes: deepDisk.bytes },
  });
}
fs.writeFileSync(path.join(DATA, 'compare.json'), JSON.stringify({ made: 'tools/map-data/compare.js', models }));
for (const m of models) {
  console.log(`${m.label.padEnd(6)} ${num(m.chars).padStart(15)} characters, engine ${num(m.engine).padStart(11)} (without < > ${num(m.engineOther)}), ${(m.writer / m.nonZero).toFixed(2)} per cell; tape ${num(m.tape)}; ${m.steps ? `steps ${num(m.steps.min)} to ${num(m.steps.max)} (positions ${m.steps.from} to ${m.steps.to}${m.steps.complete ? '' : ', stopped'})` : 'no step counts'}; data ${(m.data.totalBytes / 1e6).toFixed(0)} MB in ${m.data.files} files (tiles ${(m.data.tileBytes / 1e6).toFixed(0)} MB, text ${(m.data.deepBytes / 1e6).toFixed(0)} MB)`);
}
console.log(`compare.json: ${models.length} programs; all data ${(models.reduce((a, m) => a + m.data.totalBytes, 0) / 1e6).toFixed(0)} MB`);
