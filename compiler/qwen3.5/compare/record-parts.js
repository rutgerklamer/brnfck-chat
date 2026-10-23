'use strict';

// Records for site/compare/ the parts of Qwen3.5-0.8B that Qwen2.5 lacks, from one answer in floating point.
//   node compiler/qwen3.5/compare/record-parts.js [--model=qwen3.5-0.8b]      (about 2 minutes)

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');

const DIR = F.modelDir(), MAX_NEW = 60, OUT = path.join(__dirname, '..', '..', '..', 'site', 'compare', 'data');
const QUESTION = 'What is the capital of France?';
// the heads of the step-by-step figure: one that lets go at every full stop, and the two of the figure of two tables
const HEADS = [[17, 0, 'Lets go at full stops'], [21, 7, 'Forgets fast'], [0, 8, 'Keeps']];

const tok = F.loadTokenizer(DIR), m = F.loadModel(DIR);
const { nk, nv, dk, dv, keyDim, heads, headSize, kvHeads } = m, qDim = heads * headSize;
const att = m.types.flatMap((t, l) => (t === 'att' ? [l] : []));

// ---- one answer, with probes ----
const ids = tok.encode(tok.chatPrompt(QUESTION)), prompt = ids.length;
const cache = F.newCache(m);
const steps = HEADS.map(() => []);       // per head, per word piece: { decay, beta, q, k, v, z, size }
const gates = [];                        // per word piece: per attention layer, the gate of every head (qDim numbers in 0..1)
const sizes = [];                        // per word piece: per attention layer, |q| per head, then |k| per kv head, before the norm
let cur = null;
const probe = (name, l, a) => {
  if (name === 'xnAtt' && m.types[l] === 'att') {
    // q_proj gives per head headSize query rows, then headSize gate rows; k before its norm
    const qg = F.matvec(m.L[l].wq, a, 2 * qDim), k = F.matvec(m.L[l].wk, a, kvHeads * headSize), r = att.indexOf(l);
    const g = new Float64Array(qDim), s = [];
    for (let h = 0; h < heads; h++) {
      let ss = 0;
      for (let i = 0; i < headSize; i++) { const v = qg[2 * h * headSize + i]; ss += v * v; g[h * headSize + i] = F.sigmoid(qg[(2 * h + 1) * headSize + i]); }
      s.push(Math.sqrt(ss));
    }
    for (let h = 0; h < kvHeads; h++) { let ss = 0; for (let i = 0; i < headSize; i++) ss += k[h * headSize + i] ** 2; s.push(Math.sqrt(ss)); }
    cur.gate[r] = g; cur.size[r] = s;
  }
  if (name === 'conv' || name === 'decay' || name === 'beta' || name === 'z') {
    HEADS.forEach(([L, h], j) => {
      if (L !== l) return;
      const st = cur.heads[j], kh = Math.floor(h / (nv / nk));
      if (name === 'conv') {
        st.q = Float64Array.from(a.subarray(kh * dk, (kh + 1) * dk));
        st.k = Float64Array.from(a.subarray(keyDim + kh * dk, keyDim + (kh + 1) * dk));
        st.v = Float64Array.from(a.subarray(2 * keyDim + h * dv, 2 * keyDim + (h + 1) * dv));
      } else if (name === 'z') st.z = Float64Array.from(a.subarray(h * dv, (h + 1) * dv));
      else st[name] = a[h];
    });
  }
};
function step(token, pos, wantLogits) {
  cur = { gate: [], size: [], heads: HEADS.map(() => ({})) };
  const logits = F.forward(m, cache, token, pos, wantLogits, probe);
  HEADS.forEach(([L, h], j) => {
    const S = cache.S[L].subarray(h * dk * dv, (h + 1) * dk * dv);
    let ss = 0;
    for (let i = 0; i < S.length; i++) ss += S[i] * S[i];
    cur.heads[j].size = Math.sqrt(ss);
    cur.heads[j].S = Float64Array.from(S);
    steps[j].push(cur.heads[j]);
  });
  gates.push(cur.gate); sizes.push(cur.size);
  return logits;
}
const t0 = Date.now(), out = [];
let logits = null;
for (let pos = 0; pos < prompt; pos++) logits = step(ids[pos], pos, pos === prompt - 1);
for (let k = 0; k < MAX_NEW; k++) {
  const token = F.argmax(logits);
  if (tok.stop.includes(token)) break;
  out.push(token);
  if (k + 1 < MAX_NEW) logits = step(token, prompt + k, true);
}
const all = ids.concat(out), n = steps[0].length;
console.log(`${n} word pieces (${prompt} of the question) in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${tok.decode(out).replace(/\n/g, ' ')}`);

// The text, one piece per token. A character split over two tokens goes with the second.
function pieces(list) {
  const res = [];
  let done = 0;
  for (let i = 0; i < list.length; i++) {
    const text = tok.decode(list.slice(0, i + 1), { skipSpecial: false }).replace(/�+$/, '');
    res.push(text.slice(done));
    done = text.length;
  }
  return res;
}
const text = { question: QUESTION, model: 'Qwen3.5-0.8B', setting: 'floating point (compiler/qwen3.5/reference/float.js)', n, prompt, pieces: pieces(all.slice(0, n)),
  special: all.slice(0, n).map((id, i) => (tok.decode([id]) === '' && i < prompt ? 1 : 0)) };

const b64 = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const r4 = (v) => +v.toPrecision(4);

// ---- step.json: three DeltaNet heads per word piece: decay, write strength, q, k, v, z (16 bits, a scale per vector)
function pack(list) {
  const len = list[0].length, data = new Int16Array(list.length * len), scale = [];
  list.forEach((v, t) => {
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const sc = +(max * 1.0001).toPrecision(5);   // rounded up, so that no number passes 32767
    scale.push(sc);
    for (let i = 0; i < len; i++) data[t * len + i] = sc ? Math.round((v[i] / sc) * 32767) : 0;
  });
  return { scale, data: b64(data) };
}
const unpack = (p, len) => { const B = Buffer.from(p.data, 'base64'), d = new Int16Array(B.buffer, B.byteOffset, B.length / 2); return p.scale.map((s, t) => Float64Array.from({ length: len }, (_, i) => (d[t * len + i] / 32767) * s)); };

const stepHeads = HEADS.map(([L, h, name], j) => {
  const S = steps[j], gain = Array.from(m.L[L].gNorm, r4);
  const rec = {
    layer: L, head: h, name, decay: S.map((s) => +s.decay.toPrecision(6)), beta: S.map((s) => r4(s.beta)),
    q: pack(S.map((s) => s.q)), k: pack(S.map((s) => s.k)), v: pack(S.map((s) => s.v)), z: pack(S.map((s) => s.z)), gain, size: S.map((s) => r4(s.size)),
  };
  // the page rebuilds the table from these numbers: check that it comes out as the model's
  const k = unpack(rec.k, dk), v = unpack(rec.v, dv), T = new Float64Array(dk * dv), u = new Float64Array(dv);
  let worst = 0, absMax = 0, writeMax = 0;
  for (let t = 0; t < n; t++) {
    const g = rec.decay[t], b = rec.beta[t];
    for (let i = 0; i < T.length; i++) T[i] *= g;
    u.fill(0);
    for (let i = 0; i < dk; i++) for (let c = 0; c < dv; c++) u[c] += T[i * dv + c] * k[t][i];
    for (let c = 0; c < dv; c++) u[c] = (v[t][c] - u[c]) * b;
    for (let i = 0; i < dk; i++) for (let c = 0; c < dv; c++) { T[i * dv + c] += k[t][i] * u[c]; writeMax = Math.max(writeMax, Math.abs(k[t][i] * u[c])); }
    let d2 = 0, s2 = 0;
    for (let i = 0; i < T.length; i++) { d2 += (T[i] - S[t].S[i]) ** 2; s2 += S[t].S[i] ** 2; absMax = Math.max(absMax, Math.abs(S[t].S[i])); }
    worst = Math.max(worst, Math.sqrt(d2 / (s2 || 1)));
  }
  rec.max = r4(absMax); rec.writeMax = r4(writeMax);
  console.log(`layer ${L} head ${h}: table rebuilt from the stored numbers, worst relative error ${worst.toExponential(2)}; largest number ${absMax.toFixed(3)}`);
  return rec;
});
fs.writeFileSync(path.join(OUT, 'step.json'), JSON.stringify({ ...text, dk, dv, eps: m.eps, heads: stepHeads }));

// ---- attn.json: per attention layer |q|, |k| before their norm and the norm gains; the last one's gates (8 bits) ----
const GL = att.length - 1;   // the gate of every number is kept for the last layer that looks back, layer 23
const gate = new Uint8Array(n * qDim), size = new Uint8Array(n * att.length * (heads + kvHeads));
const SZ = [-1, 3];   // sizes before the norm, log scale 0.1 .. 1000
gates.forEach((G, t) => { for (let i = 0; i < qDim; i++) gate[t * qDim + i] = Math.round(G[GL][i] * 255); });
sizes.forEach((Z, t) => Z.forEach((s, r) => s.forEach((v, i) => { size[(t * att.length + r) * (heads + kvHeads) + i] = Math.max(1, Math.min(255, Math.round(1 + (Math.log10(v) - SZ[0]) / (SZ[1] - SZ[0]) * 254))); })));
const gain = att.map((l) => ({ q: Array.from(m.L[l].qNorm, (w) => r4(1 + w)), k: Array.from(m.L[l].kNorm, (w) => r4(1 + w)) }));
fs.writeFileSync(path.join(OUT, 'attn.json'), JSON.stringify({
  ...text, layers: att, heads, kvHeads, headSize, rotDim: m.rotDim, theta: m.theta, gateLayer: att[GL], gate: b64(gate), size: { lo: SZ[0], hi: SZ[1], data: b64(size) }, gain,
}));

// what the page says about them
for (const [r, l] of att.entries()) {
  let sum = 0, shut = 0, open = 0, cnt = 0;
  gates.forEach((G) => { for (const g of G[r]) { sum += g; cnt++; if (g < 0.1) shut++; if (g > 0.9) open++; } });
  const qs = sizes.flatMap((Z) => Z[r].slice(0, heads)), ks = sizes.flatMap((Z) => Z[r].slice(heads));
  const gq = gain[r].q, rotMean = gq.slice(0, m.rotDim).reduce((a, b) => a + b, 0) / m.rotDim, restMean = gq.slice(m.rotDim).reduce((a, b) => a + b, 0) / (headSize - m.rotDim);
  console.log(`attention layer ${l}: gate mean ${(sum / cnt).toFixed(3)}, below 0.1 ${(100 * shut / cnt).toFixed(1)}%, above 0.9 ${(100 * open / cnt).toFixed(1)}%;` +
    ` |q| ${Math.min(...qs).toFixed(1)} .. ${Math.max(...qs).toFixed(1)}, |k| ${Math.min(...ks).toFixed(1)} .. ${Math.max(...ks).toFixed(1)};` +
    ` q gain rotated ${rotMean.toFixed(2)}, rest ${restMean.toFixed(2)}, range ${Math.min(...gq).toFixed(2)} .. ${Math.max(...gq).toFixed(2)}`);
}
for (const f of ['step.json', 'attn.json']) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
