'use strict';

// normvec.js against spec.js normVec, for the four normalisations of Qwen3.5 at their real sizes, under bfrun.js.

const Spec = require('./spec');
const { synthModel } = require('./synth');
const { Engine, archOf } = require('./gen');
const { run } = require('./bfrun');

const src = synthModel(1, {}), arch = archOf(src, { maxTokens: 16, noMixer: true }, { chunk: 16 });
const c = Spec.DEFAULTS, eps = 1e-6;
const plans = {
  q: [Spec.normPlan(128, 1 / Math.sqrt(128), c.CB, c.cBits, 1e-6, c.QB, c.qBits), c.cBits],
  k: [Spec.normPlan(128, 1, c.CB, c.cBits, 1e-6, c.KB, c.KB + 2), c.cBits],
  y: [Spec.normPlan(128, Math.sqrt(128), c.OB, c.oBits, 128 * eps, c.YB, c.yBits), c.oBits],
  h: [Spec.normPlan(256, Math.sqrt(256), c.QA, c.qaBits, 256 * eps, c.NHB, c.nhBits), c.qaBits],
};
let s = 7;
const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
let failed = 0, passed = 0;
for (const [name, [NP, bits]] of Object.entries(plans)) {
  // vectors of very different sizes, from all zero to near the limit of their bits
  const cases = [];
  for (const scale of [0, 1, 3, 30, 2 ** 6, 2 ** 10, 2 ** (bits - 3), 2 ** (bits - 1) - 1]) {
    cases.push(Array.from({ length: NP.n }, () => Math.max(-(2 ** (bits - 1)), Math.min(2 ** (bits - 1) - 1, Math.round((rnd() * 2 - 1) * scale)))));
  }
  cases.push(Array.from({ length: NP.n }, (_, i) => (i === 5 ? -(2 ** (bits - 1)) : 0)));
  for (const xs of cases) {
    const e = new Engine(arch), p = e.p, X = 100, OUT = X + NP.n + 2, base = OUT + NP.n + 2, t = base + NP.n + 90;
    p.ptr = 0;
    xs.forEach((v, i) => p.addBig(X + i, v, [t, t + 1]));
    e.normVec(X, OUT, NP, base, t);
    p.to(0);
    const r = run(p.toString(), { tapeSize: t + 60 });
    const got = Array.from({ length: NP.n }, (_, i) => r.tape[OUT + i]);
    const want = new Float64Array(NP.n);
    Spec.normVec(Float64Array.from(xs), 0, NP, want, 0, new Int32Array(NP.n));
    const bad = got.findIndex((v, i) => v !== want[i]);
    const dirty = Array.from(r.tape).findIndex((v, i) => v !== 0 && !(i >= OUT && i < OUT + NP.n));
    const good = bad < 0 && dirty < 0;
    if (good) passed++; else failed++;
    console.log(`${good ? 'ok  ' : 'FAIL'}  ${name}: max |x| ${Math.max(...xs.map(Math.abs))}${bad >= 0 ? `  element ${bad}: got ${got[bad]}, want ${want[bad]}` : ''}${dirty >= 0 ? `  dirty cell ${dirty}` : ''}  [${p.toString().length} characters, ${r.steps} steps]`);
  }
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
