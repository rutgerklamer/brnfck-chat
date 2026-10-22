'use strict';

// The registry of every program of the site: site/registry.json. Every page that lists programs reads it,
// so a new program, or a new version of one, shows up everywhere.
//
// Three groups: programs that run a chat model (trained elsewhere), programs that train a network
// themselves, and their children, which write with what the training learned. A program has versions: a
// rebuild that changed it, or a pass of a long training run. Nothing is ever taken out: a version stays
// in the registry when its files are gone. The current version is the last one, or for a trained child
// the one with the lowest loss on text it never saw.
//
// It reads what this checkout has (site/programs/*.meta.json, the size table of the chat models, the
// generator of compiler/train, site/train/data/, the long runs in compiler/train/out/long/), adds what
// is new and keeps the rest. At the end it checks that every program has its insight pages.
//   node tools/registry.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'site', 'registry.json');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return null; } };
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };
const today = new Date().toISOString().slice(0, 10);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
// the day a name first comes up in the history, for the first version of a program the registry has not seen
const firstDay = (word) => git('log', '--reverse', '--format=%ad', '--date=short', '-F', `--grep=${word}`).split('\n')[0] || today;
const lastDay = (...files) => git('log', '-1', '--format=%ad', '--date=short', '--', ...files) || today;

const GROUPS = [
  { id: 'chat', title: 'Runs a chat model, trained on graphics cards elsewhere' },
  { id: 'train', title: 'Trains a network itself, from random numbers' },
  { id: 'child', title: 'Writes with what its training learned' },
];

// ---- what this checkout has --------------------------------------------------------------------

const found = [];
const add = (p, version) => found.push({ p, version });

// the chat programs: their meta files (made by the build), the weights from the size table
const shapes = (read('site/compare/data/shapes.json') || { models: [] }).models;
const weightsOf = (prog) => (shapes.find((s) => s.program === prog) || {}).total;
const CHAT = [
  { id: 'brnfck-smollm2-135m', map: 'small', does: 'runs SmolLM2-135M', model: 'SmolLM2-135M', pages: [['Inside the program', 'inside/?m=small']] },
  { id: 'brnfck-qwen2.5-0.5b', map: '0.5b', does: 'runs Qwen2.5-0.5B', model: 'Qwen2.5-0.5B', pages: [['Inside the program', 'inside/?m=0.5b']] },
  { id: 'brnfck-qwen2.5-1.5b', map: '1.5b', does: 'runs Qwen2.5-1.5B', model: 'Qwen2.5-1.5B', pages: [['Inside the program', 'inside/?m=1.5b']] },
  { id: 'brnfck-qwen3.5-0.8b', map: '0.8b', does: 'runs Qwen3.5-0.8B', model: 'Qwen3.5-0.8B', pages: [['Inside the program', 'inside/?m=0.8b']] },
  { id: 'brnfck-qwen3.5-0.8b-vision', map: '0.8b-vision', does: 'runs Qwen3.5-0.8B, with pictures', model: 'Qwen3.5-0.8B', weights: 853000000, about: true, pages: [['Looking at a picture', 'vision/']] },
  // the same shape as Qwen2.5-0.5B, other weights
  { id: 'brnfck-qwen2.5-coder-0.5b', does: 'runs Qwen2.5-Coder-0.5B, answers with brainfuck', model: 'Qwen2.5-Coder-0.5B', weights: weightsOf('brnfck-qwen2.5-0.5b'), pages: [['Brainfuck that writes brainfuck', 'coder/']] },
];
for (const c of CHAT) {
  const meta = read(`site/programs/${c.id}.meta.json`);
  const pages = [...(c.map ? [['Program map', `map/?m=${c.map}`]] : []), ...c.pages, ['Compare the models', 'compare/#eight']];
  const p = { id: c.id, group: 'chat', does: c.does, model: c.model, weights: c.weights || weightsOf(c.id), about: !!c.about, pages };
  add(p, meta && { key: meta.sha256, date: firstDay(c.id), chars: meta.programBytes, writer: meta.writerBytes, tape: meta.tapeSize });
}

// the training programs and the children of the names, from the generator and site/train/data/
const S = require('../compiler/train/spec');
const { Gen, layout } = require('../compiler/train/gen');
const TRAIN = [
  { key: 'bigram', does: 'trains a table of letter pairs', kid: 'makes up names from the letter before', map: 'train-bigram' },
  { key: 'mlp', does: 'trains a network of 64 units', kid: 'makes up names from three letters back', map: 'train-mlp' },
  { key: 'attn', does: 'trains a network with attention', kid: 'makes up names, with attention', map: 'train-attn' },
  { key: 'shakespeare', does: 'trains the same network, larger, on Shakespeare', kid: 'writes lines like Shakespeare’s', map: 'train-shakespeare', anchor: '#shakespeare' },
];
const codeDay = lastDay('compiler/train/gen.js', 'compiler/train/reference.js', 'compiler/train/spec.js', 'compiler/train/layout.js', 'compiler/train/kernels.js');
for (const t of TRAIN) {
  const m = S.MODELS[t.key], L = layout(m), weights = S.paramsOf(m).total, trainer = m.name.replace('brnfck-', 'brnfck-train-');
  const engine = new Gen(m, { child: true }).childEngine(), tr = new Gen(m).trainer(engine);
  add({ id: trainer, group: 'train', does: t.does, weights, child: m.name, pages: [['Program map', `map/?m=${t.map}`], ['Trained in brainfuck', 'train/' + (t.anchor || '')], ['Compare the models', 'compare/#eight']] },
    { key: crypto.createHash('sha256').update(tr.src, 'latin1').digest('hex'), date: codeDay, chars: tr.src.length, writer: tr.writerChars, tape: L.tapeSize });
  const kid = { id: m.name, group: 'child', does: t.kid, weights, trainedBy: trainer, pages: [['Trained in brainfuck', 'train/' + (t.anchor || '#names')], ['Compare the models', 'compare/#eight']] };
  if (t.key === 'shakespeare') continue;
  const d = read(`site/train/data/${t.key}.json`), last = d && d.loss.slice(-500);
  add(kid, d && { key: d.child.sha256, date: lastDay(`site/train/data/${t.key}.json`), chars: d.child.chars, tape: L.tapeSize, loss: +(last.reduce((a, b) => a + b, 0) / last.length / 1000).toFixed(3), steps: d.steps });
}

// the child of the Shakespeare run: one version for every pass
{
  const m = S.MODELS.shakespeare, L = layout(m), dir = path.join(ROOT, 'compiler/train/out/long', m.name);
  const kid = { id: m.name, group: 'child', does: TRAIN[3].kid, weights: S.paramsOf(m).total, trainedBy: m.name.replace('brnfck-', 'brnfck-train-'), pages: [['Trained in brainfuck', 'train/#shakespeare'], ['Compare the models', 'compare/#eight']] };
  const state = read(`compiler/train/out/long/${m.name}/state.json`), site = read('site/train/data/shakespeare.json');
  const passes = state ? state.done : site ? site.passes : [];
  if (!passes.length) add(kid, null);
  for (const d of passes) {
    const bf = path.join(dir, `pass-${String(d.pass).padStart(2, '0')}.bf`), has = fs.existsSync(bf);
    add(kid, { key: 'pass-' + d.pass, pass: d.pass, date: has ? dayOf(fs.statSync(bf).mtimeMs) : today, chars: d.childChars || (has ? fs.statSync(bf).size : undefined), tape: L.tapeSize,
      steps: d.step, loss: +d.loss.toFixed(3), held: +d.held.toFixed(3), equal: d.equal });
  }
}

// ---- merge into the registry: add, never take out ----------------------------------------------

const reg = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { programs: [] };
const news = [];
for (const { p, version } of found) {
  let e = reg.programs.find((x) => x.id === p.id);
  if (!e) { e = { ...p, versions: [] }; reg.programs.push(e); news.push(p.id); }
  Object.assign(e, p, { versions: e.versions });
  if (version && !e.versions.some((v) => v.key === version.key)) {
    const clean = Object.fromEntries(Object.entries(version).filter(([, v]) => v !== undefined));
    e.versions.push({ n: e.versions.length + 1, ...clean });
    news.push(`${p.id} version ${e.versions.length}`);
  }
}
// the current version: the best loss on unseen text where there is one, else the last
for (const e of reg.programs) {
  const held = e.versions.filter((v) => typeof v.held === 'number');
  e.current = held.length ? held.reduce((a, b) => (b.held < a.held ? b : a)).n : e.versions.length ? e.versions[e.versions.length - 1].n : 0;
}
const order = (e) => GROUPS.findIndex((g) => g.id === e.group) * 1e13 - (e.weights || 0);
reg.programs.sort((a, b) => order(a) - order(b));
reg.made = 'tools/registry.js';
reg.updated = today;
reg.groups = GROUPS;
fs.writeFileSync(FILE, JSON.stringify(reg, null, 1) + '\n');

// ---- what it says --------------------------------------------------------------------------------

const num = (n) => (n === undefined ? '-' : n.toLocaleString('en-US'));
console.log(`site/registry.json: ${reg.programs.length} programs, ${reg.programs.reduce((a, e) => a + e.versions.length, 0)} versions${news.length ? '; new: ' + news.join(', ') : '; nothing new'}`);
for (const g of GROUPS) {
  console.log(`\n${g.title}`);
  for (const e of reg.programs.filter((x) => x.group === g.id)) {
    const v = e.versions.find((x) => x.n === e.current) || {};
    console.log(`  ${e.id.padEnd(36)} ${num(e.weights).padStart(14)} weights ${num(v.chars).padStart(15)} characters  ${e.versions.length} version${e.versions.length === 1 ? '' : 's'}${v.held ? ', best ' + v.held + ' on unseen text (pass ' + v.pass + ')' : ''}`);
  }
}
// every program needs its insight pages: a map of the program, and a page that explains it
const lacks = [];
for (const e of reg.programs) {
  if (!e.versions.length) lacks.push(`${e.id}: no version in this checkout (build it, or run its training)`);
  if (e.group !== 'child' && !e.pages.some(([t]) => t === 'Program map')) lacks.push(`${e.id}: not on the Program map`);
  if (!e.pages.some(([t]) => !/Program map|Compare/.test(t))) lacks.push(`${e.id}: no page that explains it`);
}
console.log(lacks.length ? `\nstill to make:\n  ${lacks.join('\n  ')}` : '\nevery program has its pages');
