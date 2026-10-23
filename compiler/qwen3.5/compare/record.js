'use strict';

// DeltaNet memory of three Qwen3.5-0.8B answers for site/compare/: per token and head |S|, half-life, beta, D, renorm.
//   node compiler/qwen3.5/compare/record.js [--model=qwen3.5-0.8b]      (about 5 minutes)

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const DN = require('../reference/deltanet');

const DIR = F.modelDir(), MAX_NEW = 60, OUT = path.join(__dirname, '..', '..', '..', 'site', 'compare', 'data');
const ANSWERS = [
  ['france', 'What is the capital of France?'],
  ['nl', 'Wat is de hoofdstad van Nederland?'],
  ['colours', 'Name three primary colors.'],
];
const STEP = 4, SIDE = 128 / STEP; // the two heads drawn whole: every fourth key row and value column

const tok = F.loadTokenizer(DIR), src = F.openWeights(DIR), m = F.modelFrom(F.openWeights(DIR));
const lin = m.types.flatMap((t, l) => (t === 'lin' ? [l] : [])), H = m.nv, cells = lin.length * H;
const nets = m.types.map((t, l) => (t === 'lin' ? DN.build(src, l, { checks: false }) : null));
src.close();

// Renormalisations worked out as deltanet.js does (its decay tables, D at DB bits); checked against its stats.renorm.
const cfg = DN.DEFAULTS, { AB, LB, DB } = cfg;
const rq32 = (v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) => {
  const X = (v + addend - lo * 2 ** k) | 0, q = X >> k, hi = 2 ** n - 1;
  return lo + (q < 0 ? 0 : q > hi ? hi : q);
};
const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };
const lsp = Int32Array.from({ length: 64 * 2 ** AB }, (_, i) => {
  const u = i / 2 ** AB - 32, sp = u > 20 ? u : Math.log1p(Math.exp(u));
  return Math.round(Math.log(sp) * 2 ** LB);
});
const lamLo = -Math.ceil((DB + 1) * Math.LN2), lamHi = Math.ceil(Math.log((DB + 1) * Math.LN2));
const decTab = Int32Array.from({ length: (lamHi - lamLo) * 2 ** LB }, (_, i) => Math.round(2 ** DB * Math.exp(-Math.exp(i / 2 ** LB + lamLo))));
const aShift = cfg.tops.wa + cfg.weightBits - 10 + cfg.NB - AB;

const fixed = lin.map((l) => ({
  dt: Int32Array.from(m.L[l].dtBias, (v) => clampTo(Math.round(v * 2 ** AB), cfg.aBits)),
  logA: Int32Array.from(m.L[l].aLog, (v) => clampTo(Math.round(v * 2 ** LB), 16)),
}));

// One answer with the 18 DeltaNet layers in whole numbers (deltanet.js), as a brainfuck program would run them.
function record(question) {
  for (const n of nets) if (n) n.reset();
  const D = Int32Array.from({ length: cells }, () => 2 ** DB);
  const ids = tok.encode(tok.chatPrompt(question)), prompt = ids.length;
  const rows = []; // per token: { norm, half, beta, renorm, states }
  let cur = null, mismatch = 0;
  const mixers = m.types.map((t, l) => {
    if (t !== 'lin') return null;
    const r = lin.indexOf(l), net = nets[l], L = m.L[l];
    return (xn, out, pos) => {
      // decay and beta as the model has them (floats), and the decay of the whole-number layer for D
      const a = F.matvec(L.wa, xn, H), b = F.matvec(L.wb, xn, H);
      const xi = Int32Array.from(xn, (v) => clampTo(Math.round(v * 2 ** cfg.NB), cfg.nBits));
      const ai = DN.matvec(net.weights.a, xi, H);
      const before = net.stats.renorm;
      net.mixer(xn, out, pos);
      let mine = 0;
      for (let h = 0; h < H; h++) {
        const i = r * H + h, decay = Math.exp(-Math.exp(L.aLog[h]) * F.softplus(a[h] + L.dtBias[h]));
        cur.half[i] = decay <= 0 ? 0 : decay >= 1 ? Infinity : Math.log(0.5) / Math.log(decay);
        cur.beta[i] = F.sigmoid(b[h]);
        const u = rq32(rq32(ai[h], aShift, cfg.aBits) + fixed[r].dt[h] + 32 * 2 ** AB, 0, Math.log2(lsp.length), 0, 0);
        const lam = lsp[u] + fixed[r].logA[h] - lamLo * 2 ** LB, dec = lam < 0 ? 2 ** DB : lam >= decTab.length ? 0 : decTab[lam];
        D[i] = rq32(D[i] * dec, DB, DB + 1, 0);
        if (D[i] < 2 ** (DB - 1)) { cur.renorm[i] = 1; D[i] = 2 ** DB; mine++; }
        cur.scale[i] = D[i] / 2 ** DB;
      }
      if (mine !== net.stats.renorm - before) mismatch++;
      cur.norm.set(net.norms(), r * H);
    };
  });
  const step = (token, pos, wantLogits) => {
    cur = { norm: new Float64Array(cells), half: new Float64Array(cells), beta: new Float64Array(cells), renorm: new Uint8Array(cells), scale: new Float64Array(cells) };
    const logits = F.forward(m, cache, token, pos, wantLogits, null, mixers);
    cur.state = lin.map((l) => nets[l].state());
    rows.push(cur);
    return logits;
  };
  const cache = F.newCache(m), out = [];
  let logits = null;
  for (let pos = 0; pos < prompt; pos++) logits = step(ids[pos], pos, pos === prompt - 1);
  for (let k = 0; k < MAX_NEW; k++) {
    const token = F.argmax(logits);
    if (tok.stop.includes(token)) break;
    out.push(token);
    if (k + 1 < MAX_NEW) logits = step(token, prompt + k, true);
  }
  return { ids: ids.concat(out), prompt, rows, mismatch };
}

// The text, one piece per token. A character split over two tokens goes with the second.
function pieces(ids) {
  const out = [];
  let done = 0;
  for (let i = 0; i < ids.length; i++) {
    const text = tok.decode(ids.slice(0, i + 1), { skipSpecial: false }).replace(/�+$/, '');
    out.push(text.slice(done));
    done = text.length;
  }
  return out;
}

const b64 = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const q8 = (v, lo, hi) => Math.max(1, Math.min(255, Math.round(1 + ((v - lo) / (hi - lo)) * 254)));

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const [key, question] of ANSWERS) {
  const t = Date.now(), R = record(question), n = R.rows.length, ids = R.ids.slice(0, n);
  // |S| on a log scale over the powers of ten it covers; 0 stays 0
  let lo = Infinity, hi = -Infinity;
  for (const row of R.rows) for (const v of row.norm) if (v > 0) { lo = Math.min(lo, Math.log10(v)); hi = Math.max(hi, Math.log10(v)); }
  lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
  const HL = [-2, 10]; // half-life in tokens, log scale: 0.01 .. 10^10 tokens
  const scale = new Uint8Array(n * cells), norm = new Uint8Array(n * cells), half = new Uint8Array(n * cells), beta = new Uint8Array(n * cells), renorm = new Uint8Array(n * cells);
  R.rows.forEach((row, t) => {
    for (let i = 0; i < cells; i++) {
      const at = t * cells + i;
      norm[at] = row.norm[i] > 0 ? q8(Math.log10(row.norm[i]), lo, hi) : 0;
      half[at] = row.half[i] === 0 ? 0 : row.half[i] === Infinity ? 255 : q8(Math.log10(row.half[i]), ...HL);
      beta[at] = Math.round(row.beta[i] * 255);
      renorm[at] = row.renorm[i];
      scale[at] = Math.round((row.scale[i] - 0.5) * 2 * 255);
    }
  });
  // the two heads drawn whole: of the quarter that holds most at the end, the fastest and slowest to forget
  const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
  const heads = Array.from({ length: cells }, (_, i) => ({ i, end: R.rows[n - 1].norm[i], half: median(R.rows.map((row) => row.half[i])) }))
    .sort((x, y) => y.end - x.end).slice(0, cells / 4).sort((x, y) => x.half - y.half);
  const pick = [heads[0], heads[heads.length - 1]];
  const tables = pick.map(({ i, half: hl }) => {
    const r = Math.floor(i / H), h = i % H, size = 128 * 128, data = new Int8Array(n * SIDE * SIDE);
    let max = 0;
    for (const row of R.rows) for (let k = 0; k < size; k++) max = Math.max(max, Math.abs(row.state[r][h * size + k]));
    R.rows.forEach((row, t) => {
      const S = row.state[r];
      for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
        const v = S[h * size + (y * STEP) * 128 + x * STEP];
        data[t * SIDE * SIDE + y * SIDE + x] = Math.round(127 * Math.sign(v) * Math.sqrt(Math.abs(v) / max));
      }
    });
    return { row: r, layer: lin[r], head: h, half: +hl.toPrecision(3), max: +max.toPrecision(3), data: b64(data) };
  });
  const renorms = lin.map((_, r) => R.rows.reduce((s, row) => s + row.renorm.subarray(r * H, (r + 1) * H).reduce((a, b) => a + b, 0), 0));
  const file = {
    question, model: 'Qwen3.5-0.8B', setting: 'the 18 DeltaNet layers in whole numbers, 8-bit weights (compiler/qwen3.5/reference/deltanet.js)',
    layers: lin, heads: H, dk: m.dk, dv: m.dv, n, prompt: R.prompt, pieces: pieces(ids),
    special: ids.map((id, i) => (tok.decode([id]) === '' && i < R.prompt ? 1 : 0)),
    norm: { lo, hi, data: b64(norm) }, half: { lo: HL[0], hi: HL[1], data: b64(half) }, beta: b64(beta), renorm: b64(renorm), scale: b64(scale),
    side: SIDE, step: STEP, tables, renorms,
  };
  fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify(file));
  index.push({ key, question, n, prompt: R.prompt });
  console.log(`${key}: ${n} tokens (${R.prompt} prompt) in ${((Date.now() - t) / 1000).toFixed(0)} s; |S| 10^${lo} .. 10^${hi};` +
    ` ${renorms.reduce((a, b) => a + b, 0)} renormalisations, ${R.mismatch} tokens where the count differs from deltanet.js;` +
    ` heads drawn: ${tables.map((x) => `L${x.layer} h${x.head} (half-life ${x.half})`).join(', ')}`);
  console.log('  ' + tok.decode(ids.slice(R.prompt)).replace(/\n/g, ' '));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
