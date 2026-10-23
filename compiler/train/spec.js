'use strict';

// What the training programs compute, in whole numbers: the models, their fixed-point scales, the
// tables and the random numbers. reference.js and the brainfuck generators both read it.

const NAMES = '\nabcdefghijklmnopqrstuvwxyz';      // the tokens of the names: 0 = end of a name, 1..26 = a..z
const V = NAMES.length;
const SHAKESPEARE = "\n !$&',-.3:;?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";    // the 65 characters of data/shakespeare.txt
const SW = 14;                  // weights: w / 2^14
const SV = 28;                  // velocities (momentum): v / 2^28, they hold lr * gradient
const SC = 8;                   // the child's weights: w / 2^8
const MU = 3;                   // momentum 1 - 2^-3 = 0.875
const SEED = 20261021;          // seed of the starting weights
const SAMPLE_SEED = 1021;       // seed of the child's sampling

// gs: a logit's gradient is shifted right by gs (lr / batch = 2^(-5 - gs)); epochs: passes over the text; samples: lines
// the child prints; chars: the tokens (token 0 ends a line); reset: the context starts empty after every line.
const MODELS = {
  bigram: {
    name: 'brnfck-names-bigram-756', kind: 'bigram', ctx: 1, hidden: 0,
    batch: 32, gs: 1, epochs: 3, samples: 30, chars: NAMES, reset: true,
  },
  mlp: {
    name: 'brnfck-names-mlp-7k', kind: 'mlp', ctx: 3, hidden: 64,
    batch: 32, gs: 4, epochs: 20, samples: 30, chars: NAMES, reset: true,
  },
  attn: {
    name: 'brnfck-names-attn-10k', kind: 'attn', T: 8, dk: 16, ctx: 3, hidden: 64,
    batch: 32, gs: 4, epochs: 20, samples: 30, chars: NAMES, reset: true,
  },
  // Shakespeare: the same network, larger, on the first 90% of data/shakespeare.txt; tools/train-long.js runs it in 19 passes
  shakespeare: {
    name: 'brnfck-shakespeare-attn-55k', kind: 'attn', T: 16, dk: 16, ctx: 4, hidden: 128, passes: 19,
    batch: 32, gs: 4, epochs: 1, samples: 40, chars: SHAKESPEARE, reset: false, text: 'shakespeare', decay: 12,
  },
};

function paramsOf(m) {
  const V = m.chars.length;
  if (m.kind === 'bigram') return { units: V, perUnit: V, total: V * V + V };
  const H = m.hidden, mlp = m.ctx * V * H + H + H * V + V;
  if (m.kind === 'attn') return { units: H, total: mlp + (V + m.T) * H + (2 * V + m.T + 1) * m.dk };
  return { units: H, total: mlp };
}

// ---- integer helpers: every value stays a 32-bit two's complement number -------------------

const I32 = 2 ** 31;
function check(x, lim = I32, what = 'value') {
  if (!Number.isInteger(x) || x < -lim || x >= lim) throw new Error(`${what} out of range: ${x}`);
  return x;
}
// floor((x + addend) / 2^k), x kept below 2^30 so that the brainfuck shift never wraps
function rs(x, k, addend = k ? 2 ** (k - 1) : 0) {
  check(x, 2 ** 30, 'shift input');
  return Math.floor((x + addend) / 2 ** k);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The random numbers: x <- 69069 x + 1 (mod 2^32), read as a signed 32-bit number.
function lcg(x) { return (Math.imul(x, 69069) + 1) | 0; }

// ---- tables ---------------------------------------------------------------------------------

// tanh of a pre-activation index i (z = i / 32), i in -128..127; output h / 128 and 1 - tanh^2 in 128ths
const TANH = [], TPRIME = [];
for (let i = -128; i < 128; i++) {
  const t = Math.tanh(i / 32);
  TANH.push(clamp(Math.round(128 * t), -127, 127));
  TPRIME.push(Math.round(128 * (1 - t * t)));
}
// exp of a logit index minus the largest, a = -255..0 (1/16 nat): 2^14 e^(a/16)
const EXP = [];
for (let a = -255; a <= 0; a++) EXP.push(Math.round(2 ** 14 * Math.exp(a / 16)));
// the sum S of EXP over all n tokens is 2^14..n*2^14; i = S >> 7 in 128..n*128:
// RECIP[i] = 2^23 / (i + 1/2) and LN[i] = 4096 ln((i + 1/2) / 128)
const RECIP = [], LN = [];
for (let i = 0; i < 16384; i++) {          // room for 127 tokens: i < 127 * 128
  RECIP.push(i < 128 ? 0 : Math.round(2 ** 23 / (i + 0.5)));
  LN.push(i < 128 ? 0 : Math.round(4096 * Math.log((i + 0.5) / 128)));
}
// Look-up by a signed index: the tables above are stored from their lowest index on.
const tanhAt = (i) => TANH[i + 128], tprimeAt = (i) => TPRIME[i + 128], expAt = (a) => EXP[a + 255];

const tokenOf = (ch) => (ch === 10 ? 0 : ch - 96);
const charOf = (t) => (t === 0 ? 10 : t + 96);
// the child draws with this many top bits of a random number: their value times the sum S of the
// exponentials (less than tokens * 2^14) stays below 2^30; and the running sums stay below 2^sumBits
const sampleBits = (m) => Math.min(10, Math.floor(30 - Math.log2(m.chars.length * 16384)));
const sumBits = (m) => Math.ceil(Math.log2(m.chars.length * 16384));
// the token of every character code of a model (-1: not one of its characters)
const tokensOf = (m) => { const t = new Int16Array(256).fill(-1); [...m.chars].forEach((c, i) => { t[c.charCodeAt(0)] = i; }); return t; };

module.exports = {
  V, NAMES, SHAKESPEARE, SW, SV, SC, MU, SEED, SAMPLE_SEED, MODELS, paramsOf, tokensOf, sampleBits, sumBits,
  check, rs, clamp, lcg, TANH, TPRIME, EXP, RECIP, LN, tanhAt, tprimeAt, expAt, tokenOf, charOf,
};
