'use strict';

// Brainfuck code that WRITES a given tape.

const PLUS = 43, MINUS = 45, LT = 60, GT = 62;

class Out {
  constructor(sink, size = 1 << 22) { this.buf = Buffer.allocUnsafe(size); this.n = 0; this.total = 0; this.sink = sink; }
  flush() { if (this.n) { this.sink(this.buf.subarray(0, this.n)); this.total += this.n; this.n = 0; } }
  rep(ch, k) {
    while (k > 0) {
      if (this.n === this.buf.length) this.flush();
      const t = Math.min(k, this.buf.length - this.n);
      this.buf.fill(ch, this.n, this.n + t); this.n += t; k -= t;
    }
  }
  str(s) {
    if (this.n + s.length > this.buf.length) this.flush();
    if (s.length > this.buf.length) { this.sink(Buffer.from(s, 'latin1')); this.total += s.length; return; }
    this.n += this.buf.latin1Write(s, this.n);
  }
  get length() { return this.total + this.n; }
}

// ---- constants

const memo = new Map();
function constPlan(n, depth) {
  if (n <= 14 || depth <= 0) return { cost: n, b: 0 };
  const key = n * 8 + Math.min(depth, 7);
  let best = memo.get(key);
  if (best) return best;
  best = { cost: n, b: 0 };
  const tryB = (b) => {
    for (const q of [Math.floor(n / b), Math.ceil(n / b)]) {
      if (q < 1) continue;
      const r = n - q * b, c = 7 + b + Math.abs(r) + constPlan(q, depth - 1).cost;
      if (c < best.cost) best = { cost: c, b, q, r };
    }
  };
  if (n <= 200000) for (let b = 2; b <= 40 && b * 2 <= n; b++) tryB(b);
  else { let pick = 16, score = 1e9; for (let b = 10; b <= 32; b++) { const r = Math.abs(n - Math.round(n / b) * b), s = b + r; if (s < score) { score = s; pick = b; } } tryB(pick); }
  memo.set(key, best);
  return best;
}
function constCode(n, sign, depth = 7) {
  const ch = sign < 0 ? '-' : '+', pl = constPlan(n, depth);
  if (!pl.b) return ch.repeat(n);
  return '>' + constCode(pl.q, 1, depth - 1) + '[-<' + ch.repeat(pl.b) + '>]<' + (pl.r * sign < 0 ? '-' : '+').repeat(Math.abs(pl.r));
}
const constCost = (n, depth = 7) => constPlan(n, depth).cost;

function fixCode(delta) {
  const n = Math.abs(delta), ch = delta < 0 ? '-' : '+';
  if (n === 0) return '';
  let best = n + 2, a = 0;
  for (let x = 2; x * x <= n + x; x++) { const q = Math.round(n / x), c = x + q + Math.abs(n - x * q) + 8; if (q >= 1 && c < best) { best = c; a = x; } }
  if (!a) return '<' + ch.repeat(n) + '>';
  const q = Math.round(n / a), r = n - a * q;
  return '+'.repeat(a) + '[-<' + ch.repeat(q) + '>]<' + (r * (delta < 0 ? -1 : 1) < 0 ? '-' : '+').repeat(Math.abs(r)) + '>';
}

function startPlan(need) {
  const f = Math.max(2, Math.ceil(Math.cbrt(need))), b0 = Math.ceil(need / (f * f)), cost = b0 + 2 * f + 26;
  if (need <= cost) return { b: need, b0: need, f: 0, cost: need };
  return { b: b0 * f * f, b0, f, cost };
}

// ---- candidates

// fives, with up to two other radices on top of them
function candidateLists() {
  const lists = [[]];
  const tops = [[], [2], [3], [4], [6], [7], [9], [3, 3], [7, 7], [3, 7], [7, 3], [4, 4], [3, 3, 3], [7, 7, 7]];
  for (let n = 0; n <= 13; n++) for (const t of tops) { if (n + t.length > 0 && n + t.length <= 14) lists.push([...Array(n).fill(5), ...t]); }
  return lists;
}

const top1 = new Float64Array(1);
function digitCost(e, R) {
  let c = 0;
  for (let j = 0; j < R.length; j++) {
    const r = R[j], h = (r - 1) >> 1;
    let d = (e + h) % r; if (d < 0) d += r; d -= h;
    c += d < 0 ? -d : d;
    e = (e - d) / r;
  }
  top1[0] = e;
  return c;
}

// ---- the encoder

function encodeTape(tape, pointer, sink, options = {}) {
  const o = { blockMax: 8192, zeroRun: 48, sample: 512, maxPlanes: 15, ...options };
  const size = tape.length, out = new Out(sink), lists = candidateLists().filter((l) => l.length < o.maxPlanes);
  const stats = { chars: 0, cells: size, nonZero: 0, blocks: 0, blockCells: 0, blockChars: 0, directCells: 0, directChars: 0, skips: 0, skipCells: 0, skipChars: 0, digitChars: 0, moveChars: 0, loopChars: 0, radices: {}, planes: {} };
  let end = size;
  while (end > 0 && tape[end - 1] === 0) end--;
  const sample = new Float64Array(o.sample + 2);
  let pos = 0;

  // z cells to the right: z '>' or, when shorter, a counted walk (its scratch cells must stay on the tape)
  const walk = (z) => {
    const room = size - 1 - (pos + z), depth = Math.min(7, Math.max(0, room));
    if (z > 30 && constCost(z, depth) + 12 < z) out.str(constCode(z, 1, depth) + '[[->+<]>-]');
    else out.rep(GT, z);
  };
  // step over z zero cells
  const skip = (z) => {
    const before = out.length;
    walk(z);
    stats.skips++; stats.skipCells += z; stats.skipChars += out.length - before;
    pos += z;
  };

  // cells c .. c+K-1 one by one
  const directCost = (c, K) => { let t = K; for (let i = 0; i < K; i++) { const v = tape[c + i] | 0; if (v) t += constCost(Math.abs(v), Math.min(7, size - 1 - (c + i))); } return t; };
  const direct = (c, K) => {
    const before = out.length;
    for (let i = 0; i < K; i++) {
      const v = tape[c + i] | 0, depth = Math.min(7, size - 1 - (c + i));
      if (v) { if (constCost(Math.abs(v), depth) > 2e6) throw new Error(`cell ${c + i} = ${v} cannot be written here`); out.str(constCode(Math.abs(v), v < 0 ? -1 : 1, depth)); }
      if (c + i + 1 < size) out.rep(GT, 1); else if (i + 1 < K) throw new Error('past the end');
    }
    stats.directCells += K; stats.directChars += out.length - before;
    pos = Math.min(c + K, size - 1);
  };

  const choose = (c, K) => {
    let n = 0, lo = Infinity, hi = -Infinity;
    const step = Math.max(1, Math.floor(K / o.sample));
    for (let i = 0; i < K; i++) { const v = tape[c + i] | 0; if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = (step >> 1); i < K && n < o.sample; i += step) sample[n++] = tape[c + i] | 0;
    const sorted = Array.from(sample.subarray(0, n)).sort((x, y) => x - y), med = sorted[n >> 1];
    sample[n] = lo; sample[n + 1] = hi;                      // the extremes decide the start value
    const centres = med === 0 ? [0] : [med];
    let best = null;
    for (const m of centres) {
      for (const R of lists) {
        let rho = 1; for (const r of R) rho *= r;
        if (rho > 4 * (hi - lo) + 16) continue;
        let digits = 0, tmin = Infinity, tmax = -Infinity, extra = 0;
        for (let i = 0; i < n + 2; i++) {
          const dc = digitCost(sample[i] - m, R), t = top1[0];
          if (i < n) digits += dc + Math.abs(t); else extra += Math.abs(t);
          if (t < tmin) tmin = t; if (t > tmax) tmax = t;
        }
        const sp = startPlan(Math.max(1 - tmin, Math.round(m / rho), 1)), b = sp.b, fix = m - b * rho;
        if ((b + tmax + 1) * rho >= 2 ** 31) continue;       // the cells must not wrap during the passes
        const D = R.length + 1;
        const overhead = D + constCost(K) + 12 + sp.cost + R.reduce((s, r) => s + r + 9, 0) + 10 + fixCode(fix).length + 2;
        const cost = K * D + digits * (K / n) + extra + overhead;
        if (!best || cost < best.cost) best = { R, m, b, fix, cost, D, rho };
      }
    }
    return best;
  };

  let dig = new Int8Array(0), topd = new Int32Array(0);
  const block = (c, K, ch) => {
    const before = out.length, { R, m, D } = ch, P = D - 1;
    if (dig.length < K * Math.max(P, 1)) dig = new Int8Array(K * Math.max(P, 1));
    if (topd.length < K) topd = new Int32Array(K);
    let tmin = Infinity, tmax = -Infinity;
    for (let i = 0; i < K; i++) {
      let e = (tape[c + i] | 0) - m;
      for (let j = 0; j < P; j++) {
        const r = R[j], h = (r - 1) >> 1;
        let d = (e + h) % r; if (d < 0) d += r; d -= h;
        dig[j * K + i] = d; e = (e - d) / r;
      }
      if (Math.abs(e) > 2e9) throw new Error('top digit too large');
      topd[i] = e; if (e < tmin) tmin = e; if (e > tmax) tmax = e;
    }
    const sp = startPlan(Math.max(1 - tmin, Math.round(m / ch.rho), 1)), b = sp.b, fix = m - b * ch.rho;
    if ((b + tmax + 1) * ch.rho >= 2 ** 32) throw new Error('block would wrap');
    let loops = out.length;
    if (c + D + (sp.f ? 1 : 0) + K > size - 1) throw new Error('block at ' + c + ' (' + K + ' cells, ' + D + ' planes) does not fit the tape of ' + size);
    out.rep(GT, D);
    out.str(constCode(K, 1) + '[-[->+<]' + '+'.repeat(sp.b0) + '>]');
    if (sp.f) out.str('<[[->' + '+'.repeat(sp.f) + '<]<]>>[[-<' + '+'.repeat(sp.f) + '>]>]');
    stats.loopChars += out.length - loops;
    for (let j = P; j >= 0; j--) {
      if (j < P || sp.f) out.rep(LT, 1);
      const buf = out, base = j * K;
      let digits = 0;
      for (let i = K - 1; i >= 0; i--) {
        const d = j === P ? topd[i] : dig[base + i];
        if (buf.n + 1 > buf.buf.length) buf.flush();
        buf.buf[buf.n++] = LT;
        if (d > 0) { if (d <= 4 && buf.n + d <= buf.buf.length) { for (let k = 0; k < d; k++) buf.buf[buf.n++] = PLUS; } else buf.rep(PLUS, d); digits += d; }
        else if (d < 0) { if (d >= -4 && buf.n - d <= buf.buf.length) { for (let k = 0; k < -d; k++) buf.buf[buf.n++] = MINUS; } else buf.rep(MINUS, -d); digits -= d; }
      }
      stats.digitChars += digits; stats.moveChars += K;
      loops = out.length;
      if (j > 0) out.str('[[-<' + '+'.repeat(R[j - 1]) + '>]>]');
      else out.str('[[-<+>]' + fixCode(fix) + '>]<');
      stats.loopChars += out.length - loops;
    }
    stats.blocks++; stats.blockCells += K; stats.blockChars += out.length - before;
    const key = R.join(',') || '-';
    stats.radices[key] = (stats.radices[key] || 0) + K;
    stats.planes[D] = (stats.planes[D] || 0) + K;
    pos = c + K;
  };

  while (pos < end) {
    if (tape[pos] === 0) {
      let z = 1;
      while (pos + z < end && tape[pos + z] === 0) z++;
      if (z >= o.zeroRun) { skip(z); continue; }
    }
    // a block: up to blockMax cells, ending before the next long run of zeros
    let K = 0, zeros = 0;
    const limit = Math.min(o.blockMax, end - pos);
    while (K < limit) {
      if (tape[pos + K] === 0) { if (++zeros >= o.zeroRun) { K++; break; } } else zeros = 0;
      K++;
    }
    K -= zeros;                                           // (zeros at the end of a block belong to what follows)
    if (K === 0) { skip(zeros); continue; }
    const room = size - 2 - o.maxPlanes - pos;            // the strip starts up to maxPlanes + 1 cells further right
    if (room < 1) { direct(pos, end - pos); break; }
    if (K > room) K = room;
    const ch = choose(pos, K);
    if (!ch || (K <= 256 && directCost(pos, K) <= ch.cost)) direct(pos, K);
    else block(pos, K, ch);
  }
  for (let i = 0; i < end; i++) if (tape[i] !== 0) stats.nonZero++;
  // the pointer
  {
    const d = pointer - pos;
    if (d > 0) { const before = out.length; walk(d); stats.skipChars += out.length - before; }
    else out.rep(LT, -d);
    stats.finalMove = d;
  }
  out.flush();
  stats.chars = out.total;
  return stats;
}

module.exports = { encodeTape };
