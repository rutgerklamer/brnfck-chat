'use strict';

// The vision part in brainfuck (gen.js) against spec.js on synthetic models: stage by stage, then whole runs, clean tape.
//   node compiler/qwen3.5/vision/check_engine.js [quick] [seed]

const Spec = require('./spec');
const { synthVision, synthPicture } = require('./synth');
const { squares } = require('../reference/vision');
const { VisionPart } = require('./gen');
const { Engine, archOf } = require('../engine/gen');
const { synthModel } = require('../engine/synth');
const { packToArray } = require('../engine/pack');
const { run } = require('../engine/bfrun');

const args = process.argv.slice(2), quick = args.includes('quick'), seed = +(args.find((x) => /^\d+$/.test(x)) || 1);
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i < 0 ? (a.length === b.length ? '' : `(lengths ${a.length}, ${b.length})`) : `(first difference at ${i}: got ${a[i]}, want ${b[i]})`; };
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));

// The vision part alone, on a host engine of a tiny text model (only its building blocks and its text are used).
function setup(size, pictures, options = {}) {
  const V = synthVision(seed, size), sqs = pictures.map((s) => squares(synthPicture(V, s, size.side4 || 4), V.P, V.merge));
  const opts = { ...Spec.widthsFor(Spec.measure(V, sqs)), ...options };
  const net = Spec.build(V, sqs[0], opts);
  const host = new Engine(archOf(synthModel(1), { maxTokens: 16 }, { chunk: 16 }));
  const vp = new VisionPart(host, V, sqs[0], opts), v0 = 2, end = vp.layout(v0);
  host.p.ptr = 0;
  vp.emitReader();
  const readEnd = host.p.code.chars;
  vp.emitRun();
  host.p.code.join('');
  const prog = Array.from(host.p.code).join('');
  if (/[^+\-<>[\].,]/.test(prog)) throw new Error('not pure brainfuck');
  const layout = { plan: host.plan, OFFW: vp.x.OFFW, OFFE: 0, chunkRows: 1 };
  const weights = packToArray({ dim: 0, hidden: 0 }, { layers: [], emb: null }, layout, { vision: { values: () => vp.values(net) } });
  return { V, sqs, net, vp, prog, weights, tapeSize: end + 64, marks: host.marks, readEnd };
}

function runTo(S, sq, mark, hit) {
  const input = Buffer.concat([S.weights, Buffer.from(sq.bytes)]);
  const r = run(S.prog, { input, tapeSize: S.tapeSize, breakAt: mark ? { charIndex: mark.end, hit } : null });
  r.at = (v) => r.tape[v] | 0;
  r.strip = (v, n) => range(n, (i) => r.at(v + i));
  return r;
}

function check(name, size, pictures, options = {}, stages = 2) {
  const S = setup(size, pictures, options), { V, vp, net } = S, x = vp.x, { so, Lo, pre } = x, dim = V.dim, N = vp.N, depth = V.depth;
  console.log(`\n${name}: ${JSON.stringify({ dim, hidden: V.hidden, depth, heads: V.heads, squares: N, out: V.out })}; program ${S.prog.length.toLocaleString('en-US')} characters, tape ${S.tapeSize.toLocaleString('en-US')} cells, weight stream ${S.weights.length.toLocaleString('en-US')} bytes`);
  const sq = S.sqs[0], tr = {};
  const embWant = net.encode(sq.bytes, (nm, l, v) => { (tr[nm] ||= {})[l] = v; });
  const mark = (nm, u) => S.marks.find((m) => m.name === nm && m.u === u);
  const cmp = (what, got, want) => ok(same(got, want), what, firstDiff(got, want));
  // stage by stage: the first squares of every round
  for (let s = 0; s < Math.min(stages, N); s++) {
    let r = runTo(S, sq, mark('x0', null), s + 1);
    cmp(`square ${s}: the patch embedding`, r.strip(vp.P0 - x.PRE + pre.x, dim), tr.embed[-1].slice(s * dim, (s + 1) * dim));
    for (let l = 0; l < depth; l++) {
      const s1 = vp.slot(l, 1);
      r = runTo(S, sq, mark('rot', l), s + 1);
      cmp(`square ${s}, layer ${l}: q rotated`, r.strip(s1 + so.QS, dim), tr.q[l].slice(s * dim, (s + 1) * dim));
      cmp(`square ${s}, layer ${l}: k rotated`, r.strip(s1 + so.WS, dim), tr.k[l].slice(s * dim, (s + 1) * dim));
      cmp(`square ${s}, layer ${l}: v`, r.strip(s1 + so.SM, dim), tr.v[l].slice(s * dim, (s + 1) * dim));
      if (l + 1 < depth) {
        r = runTo(S, sq, mark('xout', l), s + 1);
        cmp(`square ${s}, layer ${l}: the residual after it`, r.strip(vp.Pof(l) + Lo.preD + pre.x, dim), tr.x[l].slice(s * dim, (s + 1) * dim));
      }
    }
  }
  // whole runs: the queue of pictures holds every block's vector, and every scratch cell is zero
  for (const [i, q] of S.sqs.entries()) {
    const want = i === 0 ? embWant : net.encode(q.bytes), r = runTo(S, q), G = N / vp.G, ie = vp.ie;
    const got = [], wantRev = [];
    for (let g = 0; g < G; g++) {
      const e = vp.IQ + (g + 1) * vp.IS;
      got.push(...r.strip(e + ie.V, V.out));
      wantRev.push(...want.subarray(g * V.out, (g + 1) * V.out));
    }
    ok(same(got, wantRev), `picture ${i}: the ${G} vectors in the queue of pictures`, `${firstDiff(got, wantRev)} [${r.steps.toLocaleString('en-US')} steps]`);
    const flags = range(G, (g) => r.at(vp.IQ + (g + 1) * vp.IS + ie.U)).join('');
    ok(flags === '1'.repeat(G) && r.at(vp.IQ + (G + 1) * vp.IS + ie.U) === 0, '   every entry claimed once');
    const allowed = vp.resting(), dirty = [];
    let v = 0;
    for (const [lo, hi] of [...allowed, [S.tapeSize, S.tapeSize]]) {
      for (; v < lo && dirty.length < 5; v++) if (r.tape[v] !== 0) dirty.push(v);
      v = Math.max(v, hi + 1);
    }
    ok(dirty.length === 0, '   every scratch cell is zero at the end', dirty.length ? `(dirty cells: ${dirty.join(', ')})` : '');
  }
}

check('two layers, 16 squares', { dim: 32, hidden: 64, depth: 2, heads: 2 }, [1, 2]);
if (!quick) {
  check('three layers, 64 squares, larger values', { dim: 32, hidden: 48, depth: 3, heads: 4, hot: 2, side4: 8 }, [3]);
  // 256 squares, as the program reads: counts of 256 and more are built from base-256 digits (addBig), with cells to spare
  check('two layers, 256 squares', { dim: 16, hidden: 32, depth: 2, heads: 2, side4: 16 }, [4], {}, 1);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
