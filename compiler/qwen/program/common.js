'use strict';

// What every script of compiler/qwen/program/ shares: where the files are, the architecture of a model.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { realArch } = require('../engine/real');
const { buildChat } = require('./gen');

const OUT = path.join(__dirname, 'out');
const PROGRAMS = path.join(__dirname, '..', '..', '..', 'site', 'programs');
const MODELS = ['0.5b', '1.5b'];

const TOK = { maxChars: 200 };

function files(model) {
  if (!MODELS.includes(model)) throw new Error(`unknown model ${model}: use 0.5b or 1.5b`);
  const engineWeights = path.join(__dirname, '..', 'engine', 'out', `weights-${model}.bin`);
  return {
    program: path.join(OUT, `chat-${model}.bf`), meta: path.join(OUT, `chat-${model}.meta.json`),
    tokenizer: path.join(OUT, 'tokenizer.bin'),
    weights: fs.existsSync(engineWeights) ? engineWeights : path.join(OUT, `weights-${model}.bin`),
    ref: path.join(OUT, `ref-${model}.json`),
    pure: path.join(PROGRAMS, `brnfck-qwen2.5-${model}.bf`), pureMeta: path.join(PROGRAMS, `brnfck-qwen2.5-${model}.meta.json`),
  };
}

const generate = (model) => buildChat(realArch(model), TOK);

// The WebAssembly memory a tape needs: 32 or 64 bits.
const memoryBits = (tapeSize) => (tapeSize * 4 + 2 ** 21 > 2 ** 32 - 65536 ? 64 : 32);
function backendFor(tapeSize) {
  return { bits: memoryBits(tapeSize), BFWasm: require('../../../site/runtime/bfwasm'), RunCore: require('../../../site/runtime/runcore') };
}

// The tape is committed as one block: refuse to start when the machine has no room for it now.
function needMemory(tapeSize) {
  const need = tapeSize * 4 + 2 ** 21, free = os.freemem();
  if (free < need + 2 ** 30) throw new Error(`not enough free memory for the tape: it needs ${(need / 2 ** 30).toFixed(2)} GiB (+1 GiB to work in), ${(free / 2 ** 30).toFixed(2)} GiB is free`);
}
function freeDisk() { const s = fs.statfsSync(OUT); return s.bavail * s.bsize; }

function questionBytes(text, maxBytes = TOK.maxChars) {
  let bytes = Buffer.from(String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), 'utf8');
  if (bytes.length > maxBytes) {
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    bytes = bytes.subarray(0, end);
  }
  return Buffer.concat([bytes, Buffer.from([10])]);
}

function restoreInfo(layout, arch) {
  const kv = arch.kvHeads * arch.headSize, real = layout.real;
  return {
    cells: [[real(layout.pos), 2]],                                    // POS and TOKEN (neighbours)
    slotParts: [[real(layout.usedCell(0, 0)), 1], [real(layout.keyCell(0, 0, kv - 1)), kv], [real(layout.valueCell(0, 0, kv - 1)), kv]],
    positions: arch.maxTokens, positionStep: real(layout.usedCell(1, 0)) - real(layout.usedCell(0, 0)),
    layers: arch.layers, layerStep: real(layout.usedCell(0, 1)) - real(layout.usedCell(0, 0)),
  };
}
// The same as a plain list of [first cell, number of cells].
function restoreRanges(info) {
  const out = info.cells.map((r) => r.slice());
  for (let l = 0; l < info.layers; l++) for (let pos = 0; pos < info.positions; pos++) for (const [first, n] of info.slotParts) out.push([first + l * info.layerStep + pos * info.positionStep, n]);
  return out;
}

const num = (n) => Math.round(n).toLocaleString('en-US');
const gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const now = () => Number(process.hrtime.bigint()) / 1e9;

module.exports = { OUT, TOK, files, realArch, generate, memoryBits, backendFor, needMemory, freeDisk, questionBytes, restoreInfo, restoreRanges, num, gib, now };
