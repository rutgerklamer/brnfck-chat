'use strict';

// Writes site/train/lib.js (compiler/train in one file for the browser) and site/train/data/<model>.json (reference.js).
//   node tools/site-train.js [--lib]        (--lib: only lib.js)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'site', 'train');
const MODULES = [
  'site/runtime/emit.js', 'site/runtime/patterns.js', 'compiler/core/switch.js',
  'compiler/train/spec.js', 'compiler/train/kernels.js', 'compiler/train/layout.js', 'compiler/train/gen.js',
  'compiler/train/reference.js', 'compiler/train/data.js',
];

// lib.js: every module wrapped in a function, loaded by a small require; fs, path and crypto are stubs
function writeLib() {
  const names = fs.readFileSync(path.join(ROOT, 'compiler/train/data/names.txt'), 'latin1');
  const parts = MODULES.map((f) => `${JSON.stringify(f)}: function (module, exports, require, __dirname) {\n${fs.readFileSync(path.join(ROOT, f), 'utf8')}\n}`);
  const src = `// Made by tools/site-train.js from ${MODULES.join(', ')}: do not edit.
// The generator of the training programs and the reference, for the browser: self.Train.
(function () {
'use strict';
const NAMES = ${JSON.stringify(names)};
const Buffer = { from: (s) => Uint8Array.from(s, (c) => c.charCodeAt(0)) };
const stubs = { fs: { readFileSync: () => NAMES }, path: { join: (...a) => a.join('/') }, crypto: {} };
const defs = {
${parts.join(',\n')}
};
const cache = {};
function load(id) {
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} };
  const dir = id.slice(0, id.lastIndexOf('/'));
  defs[id](module, module.exports, (spec) => {
    if (stubs[spec]) return stubs[spec];
    const out = [];
    for (const p of (dir + '/' + spec).split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    const name = out.join('/');
    return load(name.endsWith('.js') ? name : name + '.js');
  }, dir);
  return module.exports;
}
self.Train = {
  spec: load('compiler/train/spec.js'), gen: load('compiler/train/gen.js'), layout: load('compiler/train/layout.js'),
  reference: load('compiler/train/reference.js'), data: load('compiler/train/data.js'),
};
})();
`;
  fs.writeFileSync(path.join(OUT, 'lib.js'), src);
  console.log(`site/train/lib.js: ${src.length.toLocaleString('en-US')} characters`);
}

// The W cells of all slots, as the page draws them: w / 2^8, rounded, at most 127 either way.
const q8 = (vals) => Buffer.from(Int8Array.from(vals.flat(), (w) => Math.max(-127, Math.min(127, Math.round(w / 256)))).buffer).toString('base64');

function writeData(key) {
  const S = require('../compiler/train/spec'), R = require('../compiler/train/reference');
  const { trainingText } = require('../compiler/train/data');
  const { Gen, childWriting, layout } = require('../compiler/train/gen');
  const { regionValues } = require('../compiler/train/layout');
  const m = S.MODELS[key], L = layout(m), text = trainingText(m), steps = text.length / m.batch;
  const at = new Set([0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3000, 4000, 5000, steps].filter((s) => s <= steps));
  const snaps = [{ step: 0, w: q8(regionValues(L, R.initParams(m))) }];
  const t = Date.now();
  const ref = R.train(m, text, { onStep: (step, l, p) => { if (at.has(step)) snaps.push({ step, w: q8(regionValues(L, p)) }); } });
  const cp = R.childParams(ref.params);
  const names = R.sample(m, cp, m.samples);
  const engine = new Gen(m, { child: true }).childEngine();
  const child = childWriting(m, ref.params) + engine;
  const tr = new Gen(m).trainer(engine);
  // the child's weights, flat per group, for the figure of the attention
  const flat = {};
  for (const k of Object.keys(cp)) flat[k] = JSON.parse(JSON.stringify(cp[k], (kk, v) => (v && typeof v === 'object' && 'w' in v ? v.w : v)));
  const out = {
    key, name: m.name, trainer: m.name.replace('brnfck-', 'brnfck-train-'), kind: m.kind, parameters: S.paramsOf(m).total,
    batch: m.batch, epochs: m.epochs, steps, examples: text.length, T: L.T, ctx: m.ctx, hidden: m.hidden || 0, dk: m.dk || 0,
    loss: ref.losses.map((x) => Math.round(x * 1000)),
    regions: L.regions.map((Rg) => ({ units: Rg.units, slots: Rg.slots, regionSlots: Rg.regionSlots })),
    program: { chars: tr.src.length, writer: tr.writerChars, parts: tr.parts },
    snapshots: snaps, child: { chars: child.length, engine: engine.length, sha256: crypto.createHash('sha256').update(child, 'latin1').digest('hex') },
    names, childParams: m.kind === 'attn' ? flat : undefined,
  };
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  const file = path.join(OUT, 'data', `${key}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`site/train/data/${key}.json: ${fs.statSync(file).size.toLocaleString('en-US')} bytes, ${steps} steps, ${snaps.length} snapshots (${((Date.now() - t) / 1000).toFixed(0)} s)`);
}

fs.mkdirSync(OUT, { recursive: true });
writeLib();
if (!process.argv.includes('--lib')) for (const key of ['bigram', 'mlp', 'attn']) writeData(key);
