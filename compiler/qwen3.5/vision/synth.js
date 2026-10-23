'use strict';

// A small random vision part with the layout of Qwen3.5's (reference/vision.js loadVision()), for quick tests.
// Values shaped like the real ones (growing residual, one loud channel, gains up to 18); hot > 1 makes them hit clamps.

const { bf16 } = require('../engine/synth');
const F = require('../reference/float');

function synthVision(seed = 1, size = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) * 1.41; };
  const { dim = 32, hidden = 64, depth = 2, heads = 2, P = 4, merge = 2, out = 24, side = 6, theta = 10000, hot = 1 } = size;
  const headSize = dim / heads;
  if (headSize % 4) throw new Error('the head size must be a multiple of 4 (rows and columns turn half of every pair each)');
  const raw = (a) => Uint16Array.from(a, bf16), round = (a) => F.toFloat(raw(a));
  // a matrix with rows of very different sizes, as in synth.js of the engine
  const mat = (rows, cols, o, inp) => {
    const W = new Float32Array(rows * cols), sd = (o * hot) / (inp * Math.sqrt(cols));
    for (let r = 0; r < rows; r++) {
      const f = sd * [1, 1, 0.3, 2.5, 1, 4, 0.05, 1][Math.floor(rnd() * 8)];
      for (let c = 0; c < cols; c++) W[r * cols + c] = gauss() * f;
    }
    return W;
  };
  const vec = (n, sd, mean = 0) => Float32Array.from({ length: n }, () => mean + gauss() * sd);
  const gains = (n, big) => Float32Array.from({ length: n }, (_, i) => (i % 13 === 5 ? big * (0.6 + 0.4 * rnd()) : i % 11 === 3 ? -0.4 : 0.3 + 1.5 * rnd()));
  const inN = 3 * P * P;
  const V = {
    dim, hidden, depth, heads, headSize, P, merge, out, side, theta, eps: 1e-6, imageToken: 248056,
    patch: round(mat(dim, inN, 0.6, 0.6).map((w) => w * 127.5 / 127.5)), patchBias: round(vec(dim, 0.6)),
    posEmbed: round(vec(side * side * dim, 0.9)), blocks: [],
  };
  for (let l = 0; l < depth; l++) {
    const grow = [1, 3, 20][Math.min(l, 2)], last = l === depth - 1;
    const fc2 = mat(dim, hidden, 0.5 * grow, 4);
    for (let r = 0; r < hidden; r++) fc2[(l % dim) * hidden + r] *= 6;          // one loud channel
    V.blocks.push({
      n1w: round(gains(dim, 3)), n1b: round(vec(dim, 1.2)), n2w: round(gains(dim, last ? 18 : 6)), n2b: round(vec(dim, 2 * grow)),
      qkv: raw(mat(3 * dim, dim, 3, 3)), qkvB: round(vec(3 * dim, 2.5)),
      proj: raw(mat(dim, dim, 0.8, 1.5)), projB: round(vec(dim, 1.2)),
      fc1: raw(mat(hidden, dim, last ? 40 : 4, 4)), fc1B: round(vec(hidden, 1.5, last ? 2 : -1)),
      fc2: raw(fc2), fc2B: round(vec(dim, 1.5)),
    });
  }
  const wide = merge * merge * dim;
  V.merger = { nw: round(gains(dim, 4)), nb: round(vec(dim, 1.5)), fc1: raw(mat(wide, wide, 1.5, 3)), fc1B: round(vec(wide, 0.05)), fc2: raw(mat(out, wide, 0.6, 0.5)), fc2B: round(vec(out, 0.1)) };
  V.freq = Float64Array.from({ length: headSize / 4 }, (_, j) => Math.pow(theta, -(2 * j) / (headSize / 2)));
  return V;
}

// A picture for it: side x side squares of P x P pixels, smooth colours with some noise.
function synthPicture(V, seed = 1, squaresPerSide = 4) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const W = squaresPerSide * V.P, rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const v = 128 + 100 * Math.sin((x * (c + 1)) / 5 + y / 7 + seed) + 40 * (rnd() - 0.5);
    rgb[(y * W + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { W, H: W, rgb };
}

module.exports = { synthVision, synthPicture };
