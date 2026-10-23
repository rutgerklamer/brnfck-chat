'use strict';
// The main numbers of the five chat programs (models.js IDS) side by side, from what tools/map-data wrote: compare.json.
const fs = require('fs');
const path = require('path');
const { DEFS, IDS, DATA, ROOT, num } = require('./models');

// The names and colour families of the sections of an engine, as the pages have them (site/inside/engine-sections.js)
global.window = global.window || {};
require(path.join(ROOT, 'site', 'inside', 'engine-sections.js'));
const famsOf = (E, ids) => { const SEC = window.EngineSections.of(E); return ids.map((id) => SEC[id].fam); };

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
  // (the picture program has no checks.json: its checks are those of compiler/qwen3.5/vision/verify_pure.js)
  const need = ['writer.json', 'engine.json', 'tiles.json', ...(DEFS[id].vision ? [] : ['checks.json'])].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (need.length) { console.log(`${id}: left out, missing ${need.join(', ')}`); continue; }
  const W = read('writer.json'), E = read('engine.json'), T = read('tiles.json'), C = DEFS[id].vision ? null : read('checks.json');
  const all = W.counts.writer.map((v, i) => v + W.counts.engine[i]), eng = W.counts.engine;
  // tape cells and text characters by kind of region; all of the picture program's vision part counts as 'picture'
  const V = E.model.vision, kindOf = (r) => (V && r.from >= V.from ? 'picture' : r.kind);
  const tapeKinds = {}, textKinds = {};
  for (const r of W.regions) tapeKinds[kindOf(r)] = (tapeKinds[kindOf(r)] || 0) + r.to - r.from;
  for (const [ri, from, to] of W.stretches) { const k = kindOf(W.regions[ri]); textKinds[k] = (textKinds[k] || 0) + to - from; }
  textKinds.work = (textKinds.work || 0) + W.finalMove.chars;
  const cells = (kinds) => W.regions.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.rows * r.cols, 0);
  let steps = null;
  const names = fs.existsSync(path.join(dir, 'traces.json')) ? read('traces.json') : [];
  if (names.length) {
    const runs = names.map((n) => read(`trace-${n}.json`)), long = runs[runs.length - 1], first = runs[0], tot = long.positions.map((p) => p.total);
    // position 24: the first after the fixed opening lines (brnfck-qwen3.5-0.8b has none, and runs it too)
    const p24 = first.positions.find((p) => p.position === 24) || first.positions.find((p) => p.position === first.fixedPositions) || first.positions[0];
    steps = {
      question: long.question, runs: runs.length, complete: long.complete !== false, from: long.positions[0].position, to: long.positions[long.positions.length - 1].position, count: long.positions.length,
      first: tot[0], min: Math.min(...tot), max: Math.max(...tot), sections: first.sections, fams: famsOf(E, first.sections),
      ...(first.textSections ? { textSections: first.textSections } : {}),
      pos24: { position: p24.position, question: first.question, total: p24.total, steps: p24.steps, ...(p24.textSteps ? { textSteps: p24.textSteps } : {}) },
    };
  }
  const disk = folder(dir), tilesDisk = folder(path.join(dir, 'tiles')), deepDisk = folder(path.join(dir, 'deep'));
  const a = E.model;
  models.push({
    id, ...(V ? { vision: true, pictureEngine: E.sections.filter((s) => s.layerKind === 'vision' || s.id === 'vstart' || s.id === 'vend').reduce((a, s) => a + s.to - s.from, 0) } : {}), label: DEFS[id].label, name: W.modelName || a.name, family: E.family, file: W.file, layers: a.layers, attLayers: a.types ? a.types.filter((t) => t === 'att').length : a.layers, dim: a.dim, hidden: a.hidden, heads: a.heads, kvHeads: a.kvHeads, vocab: a.vocab, weightBits: a.weightBits,
    chars: W.program.chars, writer: W.program.writer, engine: W.program.engine, counts: { order: W.counts.order, all, engine: eng },
    engineLoops: eng[4], engineMoves: eng[2] + eng[3], engineOther: W.program.engine - eng[2] - eng[3], engineSections: E.sections.length, engineDepth: W.counts.maxDepthEngine,
    tape: W.program.tape, memoryBits: W.program.memoryBits || 32, nonZero: W.tape.nonZero, entropy: W.tape.entropyBitsPerCell, floor: W.tape.floorCharsAt3Bits, plainCounting: W.tape.plainCounting,
    blocks: W.encoder.blocks, matrixWeights: cells(W.weights.kinds), tableCells: cells(['emb']), tapeKinds, textKinds,
    timing: C ? { ...C.timing, writeSeconds: C.tapeRun ? C.tapeRun.seconds : null, log: C.from[0] } : null,
    steps, order: T.order, side: T.side,
    data: { totalBytes: disk.bytes, files: disk.files, tiles: tilesDisk.files, tileBytes: tilesDisk.bytes, deepPieces: deepDisk.files, deepBytes: deepDisk.bytes },
  });
}
fs.writeFileSync(path.join(DATA, 'compare.json'), JSON.stringify({ made: 'tools/map-data/compare.js', models }));
for (const m of models) {
  console.log(`${m.label.padEnd(6)} ${num(m.chars).padStart(15)} characters, engine ${num(m.engine).padStart(11)} (without < > ${num(m.engineOther)}), ${(m.writer / m.nonZero).toFixed(2)} per cell; tape ${num(m.tape)}; ${m.steps ? `steps ${num(m.steps.min)} to ${num(m.steps.max)} (positions ${m.steps.from} to ${m.steps.to}${m.steps.complete ? '' : ', stopped'})` : 'no step counts'}; data ${(m.data.totalBytes / 1e6).toFixed(0)} MB in ${m.data.files} files (tiles ${(m.data.tileBytes / 1e6).toFixed(0)} MB, text ${(m.data.deepBytes / 1e6).toFixed(0)} MB)`);
}
console.log(`compare.json: ${models.length} programs; all data ${(models.reduce((a, m) => a + m.data.totalBytes, 0) / 1e6).toFixed(0)} MB`);
