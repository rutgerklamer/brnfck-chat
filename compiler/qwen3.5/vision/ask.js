'use strict';

// Ask brnfck-qwen3.5-0.8b-vision (build_pure.js) about a PNG; another size is cut to its middle square, scaled to 256 x 256.
//   node compiler/qwen3.5/vision/ask.js [--max N] picture.png ["Describe this picture in one sentence."]

const fs = require('fs');
const { session, runPure, pieceTimes } = require('../../qwen/program/run');
const VR = require('../reference/vision');
const { SIDE, inputBytes } = require('./build');
const { PURE } = require('./build_pure');

const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';

// The middle square of a picture, scaled to side x side pixels: every new pixel the mean of the old ones it covers.
function fit(pic, side) {
  const s = Math.min(pic.W, pic.H), x0 = (pic.W - s) / 2, y0 = (pic.H - s) / 2, rgb = new Uint8Array(side * side * 3);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const ya = y0 + (y * s) / side, yb = y0 + ((y + 1) * s) / side, xa = x0 + (x * s) / side, xb = x0 + ((x + 1) * s) / side;
    const sum = [0, 0, 0];
    let w = 0;
    for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
      const f = (Math.min(yb, yy + 1) - Math.max(ya, yy)) * (Math.min(xb, xx + 1) - Math.max(xa, xx));
      for (let c = 0; c < 3; c++) sum[c] += f * pic.rgb[(yy * pic.W + xx) * 3 + c];
      w += f;
    }
    for (let c = 0; c < 3; c++) rgb[(y * side + x) * 3 + c] = Math.round(sum[c] / w);
  }
  return { W: side, H: side, rgb };
}

function main() {
  const a = process.argv.slice(2), i = a.indexOf('--max'), max = i < 0 ? 0 : +a.splice(i, 2)[1];
  const file = a.shift(), question = a.join(' ') || 'Describe this picture in one sentence.';
  if (!file) throw new Error('usage: node compiler/qwen3.5/vision/ask.js [--max N] picture.png ["question"]');
  if (!fs.existsSync(PURE.program) || !fs.existsSync(PURE.meta)) throw new Error(`${PURE.program} is missing: build it first (node tools/build.js 0.8b-vision)`);
  let pic = VR.readPng(file);
  if (pic.W !== SIDE || pic.H !== SIDE) pic = fit(pic, SIDE);
  const meta = JSON.parse(fs.readFileSync(PURE.meta, 'utf8')), input = inputBytes(pic, question);
  const tty = process.stderr.isTTY, dec = new TextDecoder('utf-8'), S = session(meta.tapeSize);
  console.error(`Q: ${question}   (picture: ${file})`);
  console.error(`[Qwen3.5-0.8B with its vision part as ${num(meta.programBytes)} characters of brainfuck; tape ${gib(meta.tapeSize * 4)}, ${S.bits}-bit memory]`);
  let t0 = null;
  const r = runPure(S, PURE.program, input, {
    stopAfterPieces: max,
    onOutput: (bytes) => { const s = dec.decode(bytes, { stream: true }); if (s) fs.writeSync(1, s); },
    onProgress: (at, total) => { if (tty) process.stderr.write(`\rrunning the program text: ${(at / 2 ** 30).toFixed(2)} of ${(total / 2 ** 30).toFixed(2)} GiB `); },
    onStart: (s) => {
      if (tty) process.stderr.write('\r' + ' '.repeat(60) + '\r');
      console.error(`[start-up ${(s.stream + s.compile).toFixed(1)} s: the program wrote its own weights (${s.stream.toFixed(1)} s of brainfuck executed from disk), its last part was compiled in ${s.compile.toFixed(1)} s]`);
      console.error('[now it reads the picture, square by square, looks at it through 12 layers, reads the question and answers]');
      t0 = s.stream + s.compile; fs.writeSync(1, 'A: ');
    },
  });
  fs.writeSync(1, '\n');
  const pt = pieceTimes(r.marks);
  console.error(`[input: the ${num(input.length)} bytes of the picture's squares, the question and its newline, nothing else]`);
  console.error(`[first word piece ${r.marks.length ? (r.marks[0] - (t0 || 0)).toFixed(1) : '-'} s after the start-up (the picture and the question pass through the model first); ${r.marks.length} word pieces, ` +
    `${pt ? pt.median.toFixed(2) : '-'} s per word piece (median); whole run ${r.seconds.total.toFixed(1)} s${r.aborted ? `; stopped by --max ${max}` : ''}]`);
}

module.exports = { fit };
if (require.main === module) { try { main(); } catch (e) { console.error(String(e.message || e)); process.exit(1); } }
