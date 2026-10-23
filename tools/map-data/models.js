'use strict';
// The five programs, what the scripts of this folder need to know about each, and their shared helpers.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'site', 'inside', 'data');
const DEFS = {
  small: {
    family: 'smol', name: 'SmolLM2-135M-Instruct', label: 'brnfck-smollm2-135m', web: 'programs/brnfck-smollm2-135m.bf',
    log: 'compiler/smollm/pure/out/verify.log', logOf: 'node compiler/smollm/pure/verify.js',
  },
  '0.5b': {
    family: 'qwen', name: 'Qwen2.5-0.5B-Instruct', label: 'brnfck-qwen2.5-0.5b', web: 'programs/brnfck-qwen2.5-0.5b.bf',
    log: 'compiler/qwen/program/out/verify_pure-0.5b.log', logOf: 'node compiler/qwen/program/verify_pure.js 0.5b',
  },
  '1.5b': {
    family: 'qwen', name: 'Qwen2.5-1.5B-Instruct', label: 'brnfck-qwen2.5-1.5b', web: 'programs/brnfck-qwen2.5-1.5b.bf',
    log: 'compiler/qwen/program/out/verify_pure-1.5b.log', logOf: 'node compiler/qwen/program/verify_pure.js 1.5b',
  },
  '0.8b': {
    family: 'qwen3.5', name: 'Qwen3.5-0.8B', label: 'brnfck-qwen3.5-0.8b', web: 'programs/brnfck-qwen3.5-0.8b.bf',
    log: 'compiler/qwen3.5/program/out/verify_pure.log', logOf: 'node compiler/qwen3.5/program/verify_pure.js',
  },
  // brnfck-qwen3.5-0.8b with the vision part at the end of its tape: it reads a picture, then the question
  '0.8b-vision': {
    family: 'qwen3.5', vision: true, name: 'Qwen3.5-0.8B', label: 'brnfck-qwen3.5-0.8b-vision', web: 'programs/brnfck-qwen3.5-0.8b-vision.bf',
    log: 'compiler/qwen3.5/vision/out/verify_pure.log', logOf: 'node compiler/qwen3.5/vision/verify_pure.js',
  },
  // the four programs that train a network themselves (compiler/train): their map data comes from tools/map-data/train.js
  'train-bigram': { family: 'train', train: 'bigram', name: 'brnfck-names-bigram-756', label: 'brnfck-train-names-bigram-756', web: 'programs/brnfck-train-names-bigram-756.bf', log: 'compiler/train/out/brnfck-names-bigram-756.txt', logOf: 'node tools/train.js bigram' },
  'train-mlp': { family: 'train', train: 'mlp', name: 'brnfck-names-mlp-7k', label: 'brnfck-train-names-mlp-7k', web: 'programs/brnfck-train-names-mlp-7k.bf', log: 'compiler/train/out/brnfck-names-mlp-7k.txt', logOf: 'node tools/train.js mlp' },
  'train-attn': { family: 'train', train: 'attn', name: 'brnfck-names-attn-10k', label: 'brnfck-train-names-attn-10k', web: 'programs/brnfck-train-names-attn-10k.bf', log: 'compiler/train/out/brnfck-names-attn-10k.txt', logOf: 'node tools/train.js attn' },
  'train-shakespeare': { family: 'train', train: 'shakespeare', name: 'brnfck-shakespeare-attn-55k', label: 'brnfck-train-shakespeare-attn-55k', web: 'programs/brnfck-train-shakespeare-attn-55k.bf', log: 'compiler/train/out/brnfck-shakespeare-attn-55k.txt', logOf: 'node tools/train-long.js shakespeare' },
};
const IDS = Object.keys(DEFS).filter((id) => !DEFS[id].train);         // the five chat programs

const COMMANDS = '+-<>[].,';
const commandIndex = new Int8Array(256).fill(-1);
for (let i = 0; i < 8; i++) commandIndex[COMMANDS.charCodeAt(i)] = i;
const num = (n) => Math.round(n).toLocaleString('en-US');
const gib = (n) => (n / 2 ** 30).toFixed(1) + ' GiB';

function modelOf(id = 'small') {
  const d = DEFS[id];
  if (!d) throw new Error(`unknown model "${id}": use ${IDS.join(', ')}`);
  const file = path.join(ROOT, 'site', d.web), meta = JSON.parse(fs.readFileSync(file.replace(/\.bf$/, '.meta.json'), 'utf8'));
  const dir = path.join(DATA, id);
  fs.mkdirSync(dir, { recursive: true });
  const M = {
    id, ...d, file, meta, dir, logFile: path.join(ROOT, d.log),
    // Refuse to start a large run when the machine has no room for it right now.
    checkMemory() {
      const free = os.freemem(), floor = id === '1.5b' ? 12 * 2 ** 30 : meta.tapeSize * 4 + 2 ** 21 + 2 ** 30;
      if (free < floor) throw new Error(`not enough free memory for the tape of ${id}: ${gib(free)} free, ${gib(floor)} wanted`);
    },
    // The writing part of the file, run without any input: the tape with the model on it.
    runWriter() {
      M.checkMemory();
      if (d.family === 'smol') {
        const { runFile } = require(path.join(ROOT, 'compiler', 'smollm', 'pure', 'run'));
        const r = runFile(file, { tapeSize: meta.tapeSize, stopAt: meta.writerBytes, input: new Uint8Array(0) });
        if (r.pointer !== meta.pointerAfterWriting) throw new Error('pointer after the writing part is not the one of the meta file');
        return { tape: r.tape, pointer: r.pointer };
      }
      // (the Qwen3.5 program is run as its own verify_pure.js does: with the runner of compiler/qwen)
      const { session, runPure } = require(path.join(ROOT, 'compiler', 'qwen', 'program', 'run'));
      const S = session(meta.tapeSize), r = runPure(S, file, Buffer.alloc(0), { stopAt: meta.writerBytes });
      if (r.pointer !== meta.pointerAfterWriting) throw new Error('pointer after the writing part is not the one of the meta file');
      return { tape: S.tape(), pointer: r.pointer, bits: S.bits };
    },
    // The engine part of the file, checked against the text the generator writes.
    readEngine(G) {
      const rest = Buffer.alloc(meta.restBytes), fd = fs.openSync(file, 'r');
      fs.readSync(fd, rest, 0, rest.length, meta.writerBytes);
      fs.closeSync(fd);
      let at = 0;
      for (const piece of G.restChunks || [G.restSrc]) { if (rest.toString('latin1', at, at + piece.length) !== piece) at = -1; if (at < 0) break; at += piece.length; }
      if (at !== rest.length) throw new Error('the end of the file is not the engine text of the generator');
      return rest;
    },
    ref() {
      const smol = d.family === 'smol', rel = smol ? 'compiler/smollm/program/out/ref.json' : d.family === 'qwen3.5' ? 'compiler/qwen3.5/engine/out/ref-qwen3.5-0.8b.json' : `compiler/qwen/program/out/ref-${id}.json`;
      const r = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      const cases = smol ? r.cases.map((c) => ({ question: c.question, text: c.text })) : r.questions.map((c) => ({ question: c.question, text: c.text, ended: c.ended }));
      // the Qwen3.5 program runs every position from 0: no opening lines are written into its memory beforehand
      return { prefix: d.family === 'qwen3.5' ? 0 : r.prefix, cases, file: rel };
    },
    // The bytes the program reads for a question.
    questionBytes(q) {
      if (d.family === 'smol') return Buffer.from(q + '\n', 'utf8');
      if (d.family === 'qwen3.5') return require(path.join(ROOT, 'compiler', 'qwen3.5', 'program', 'build')).questionBytes(q);
      return require(path.join(ROOT, 'compiler', 'qwen', 'program', 'common')).questionBytes(q);
    },
  };
  return M;
}

module.exports = { modelOf, DEFS, IDS, ROOT, DATA, COMMANDS, commandIndex, num, gib };
