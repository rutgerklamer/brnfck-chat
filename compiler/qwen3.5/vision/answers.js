'use strict';

// Writes site/vision/data/answers.json for the figures "What it said" and "What it costs": the program's own runs
// (out/run-<n>.json, noted by verify_pure.js ask) and its tape in parts, from the layout of program.js.

const fs = require('fs');
const path = require('path');
const { plan, QUESTIONS } = require('./build');
const { PURE } = require('./build_pure');

const OUT = path.join(__dirname, 'out'), FILE = path.join(__dirname, '..', '..', '..', 'site', 'vision', 'data', 'answers.json');
const ALT = { cat: 'A tabby cat with blue eyes', windmills: 'Windmills at the Zaanse Schans', bicycle: 'A bicycle on a path', apples: 'A pile of apples' };
const num = (n) => Math.round(n).toLocaleString('en-US');
const span = (s) => (s < 120 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

// The tape, part by part (real cells): the text engine and the tokenizer as in brnfck-qwen3.5-0.8b, then the vision part.
function tapeParts() {
  const { e } = plan(), vp = e.vp, x = vp.x, M = x.M, cells = (Mx) => Mx.C * (Mx.R + 1);
  const layerWeights = vp.depth * (cells(M.qkv) + cells(M.o) + cells(M.w13) + cells(M.w2));
  const slots = vp.depth * (vp.N + 2) * x.SS, edges = cells(vp.Mp) + cells(vp.Mm1) + cells(vp.Mm2), region = vp.end - vp.SQ;
  const parts = [
    { name: 'The text model: its weights, memory and working cells', cells: e.N + 1, colour: '--c-lt' },
    { name: 'The tokenizer', cells: e.vReal - (e.N + 1), colour: '--c-lt' },
    { name: 'The weights of the 12 layers that look at the picture', cells: layerWeights, colour: '--go' },
    { name: 'Their slots: 256 squares in each layer', cells: slots, colour: '--go' },
    { name: 'The squares in, the merger out: their weights', cells: edges, colour: '--go' },
    { name: 'Queues and working cells of the picture', cells: region - layerWeights - slots - edges + (e.tapeEnd - e.vReal - region), colour: '--go' },
  ];
  return { parts, region };
}

function main() {
  const meta = JSON.parse(fs.readFileSync(PURE.meta, 'utf8')), runs = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const f = path.join(OUT, `run-${i}.json`);
    if (!fs.existsSync(f)) { console.log(`run ${i} (${QUESTIONS[i].join(': ')}): not run yet (node compiler/qwen3.5/vision/verify_pure.js ask ${i})`); continue; }
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!r.same) throw new Error(`run ${i}: the program's text is not the spec's`);
    runs.push({ i, ...r });
  }
  if (!runs.length) throw new Error('no runs: node compiler/qwen3.5/vision/verify_pure.js ask 0 1 2 3 4 5');
  const answers = runs.map((r) => ({
    picture: r.picture, alt: ALT[r.picture], question: r.question, text: r.text.trim() + (r.ended ? '' : ' …'),
    note: r.ended ? `${r.pieces} word pieces, then the program ended the answer.` : `Stopped after ${r.pieces} word pieces, the limit of these runs.`,
  }));
  const { parts, region: vision } = tapeParts(), total = parts.reduce((s, p) => s + p.cells, 0);
  if (total !== meta.tapeSize) throw new Error(`the parts add up to ${total} cells, the tape has ${meta.tapeSize}`);
  const lead = runs.find((r) => r.i === 0) || runs[0], s = lead.seconds;
  const costSaid = `One question about the cat took ${span(s.total)}: ${span(s.startup)} to start up, while the program wrote its weights; ` +
    `${span(s.first - s.startup)} for the 256 squares through 12 layers and the ${lead.promptIds} word pieces of the prompt; then ${s.perPiece.toFixed(1)} s for every word piece of the answer.`;
  const costCap = `The bars are the ${num(meta.tapeSize)} cells of the tape, to scale: ${num(vision)} of them (${(100 * vision / total).toFixed(1)}%) are for the picture. ` +
    `Counted from the layout of the program (compiler/qwen3.5/vision/answers.js). The times are of one run of ${num(meta.programBytes)} characters on the computer that built it (8 cores, 32 GB), ` +
    `in WebAssembly under Node.js (compiler/qwen3.5/vision/verify_pure.js), on ${lead.date}.`;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ made: 'compiler/qwen3.5/vision/answers.js', answers, tape: parts, costSaid, costCap }, null, 1));
  for (const p of parts) console.log(`${num(p.cells).padStart(15)}  ${p.name}`);
  console.log(`${num(total).padStart(15)}  the tape\n${costSaid}\n${answers.length} answers; ${FILE} written`);
}

if (require.main === module) main();
