'use strict';

// The text engine of Qwen3.5 with its eyes: the vision part (gen.js) on the same tape, and the word pieces
// <|image_pad|> of the prompt reading its vectors.
//
// - The vision part lies at the end of the tape, after the tokenizer (real addresses; virtual addresses below 0):
//   every word piece walks between the global cells, the tokenizer and the embedding table, and nothing of that
//   crosses it. Its queue of pictures is its end next to the tokenizer, about two million cells from the table.
// - The vision part is read in with the weights, after the text model's, and runs after the weights and before the
//   question: it reads the picture (its squares, byte by byte) and leaves one vector per four squares in its queue.
// - At a position whose token is <|image_pad|> the next vector is taken from that queue into the gap of the embedding
//   table (beforeEmb). It travels with the gap through the table, next to the row it picks (the row of <|image_pad|>
//   is all zeros), and at the end of the table it is added to the residual (afterEmb): the input of that position is
//   the picture's vector, at the scale of the table.
// - The rotation of the full attention layers takes, at every position, the place of that position in the picture
//   (../engine/spec.js rope; layout.js).
// The same parts make two programs: on the bare engine (the prompt as ids; the tests) and on the chat program (the
// prompt as text, through the tokenizer; the program itself).

const { Engine, archOf, K } = require('../engine/gen');
const { ChatProgram } = require('../program/gen');
const { VisionPart } = require('./gen');
const T = require('../tokenizer/gen');

const { range, ZW } = K;

// The architecture of the text engine with room for the vision part and for a picture's vector in the embedding gap.
// vision: { V, sq, options } (gen.js VisionPart); the rope of options.rope must be that of layout.js for sq.
function visionArch(shape, options, extra, vision) {
  const dim = shape.dim;
  if (vision.V.out !== dim) throw new Error('the vision part must hand the text model vectors of its width');
  return archOf(shape, options, {
    ...extra, vision,
    // the picture's vector at the end of the gap, the scratch of its moves before it
    embRoom: (Me) => { Me.ivs = Me.G + 1; Me.iv = Me.ivs + dim + ZW + 4; Me.G = Me.iv + dim; },
  });
}

const withVision = (Base) => class extends Base {
  constructor(arch, ...rest) {
    super(arch, ...rest);
    const vision = this.a.vision;
    if (!vision) throw new Error('no vision part: build the architecture with visionArch()');
    // the vision part from the first real cell after the engine and the tokenizer on: virtual addresses below 0
    const vp = this.vp = new VisionPart(this, vision.V, vision.sq, vision.options), size = vp.layout(0);
    this.vReal = (this.tok ? this.tok.tapeSize : this.N + 1) + 2;
    vp.layout(this.N - (this.vReal + size));
    this.tapeEnd = this.vReal + size + 2;
    this.imageToken = vision.V.imageToken;
    if (this.imageToken >= this.a.vocab) throw new Error('the token of a picture is not in the vocabulary');
  }

  // The picture's vector rides the gap of the embedding table along (sweepEmb of compiler/qwen/engine/gen.js, with
  // the cells of the vector moved on with the gap after every column).
  sweepEmb() {
    const p = this.p, M = this.M.emb, { R: V, G } = M, org = this.E, c = (k) => org + M.ctrl + k, dim = this.a.dim;
    const S0 = org + G + 1, D0 = org + 1, L0 = org + M.lane, IV = org + M.iv;
    p.to(c(0)).raw('[').add(c(0), -1);
    p.copy(c(2), L0, c(5));
    p.to(L0).raw('['); p.move(S0, D0); p.add(L0, -1); p.move(L0, L0 + 1); p.to(L0 + 1).raw(']'); p.ptr = L0;
    p.scatter(S0, [[D0, 1], [L0 + 1, 1]]);
    p.to(S0 + 1).raw('['); p.move(S0 + 1, D0 + 1); p.move(L0 + 1, L0 + 2); p.to(S0 + 2).raw(']'); p.ptr = S0 + V;
    this.slide(dim, org + M.ivs, 1, 1, () => p.move(IV, IV + V + 1));      // (before the picked numbers move on into the cells it uses)
    this.stripRight(org + M.y, V + 2);
    p.move(L0 + V, org + M.y + V + 1);
    for (const k of [2, 1, 0]) p.move(c(k), c(k) + V + 1);
    p.to(c(0) + V + 1).raw(']');
    p.ptr = c(0) + M.C * (V + 1);
  }

  // At a position whose token is <|image_pad|>: the next vector of the queue of pictures into the gap. After the last
  // one the flags of the queue are cleared.
  beforeEmb() {
    const { p, gl, vp } = this, c = (i) => gl.PRT + i, [t0, v, hit] = range(3, c), hop = [c(4), c(5)];
    p.copy(gl.TOKEN, v, t0); p.addBig(v, -this.imageToken, hop);
    p.add(hit, 1); p.ifNonZero(v, () => p.add(hit, -1));
    p.loop(hit, () => {
      p.add(hit, -1);
      const q0 = vp.IQ, ie = vp.ie, left = q0 + ie.T;
      vp.takeFirst(q0, vp.IS, ie, [[ie.V, vp.out]]);
      this.slide(vp.out, q0 + ie.scr, 1, 1, () => p.move(q0 + ie.V, this.E + this.M.emb.iv));
      p.add(left, -1);
      p.whenZero(left, [q0 + ie.T + 1, q0 + ie.T + 2, q0 + ie.T + 3], () => {
        vp.flags(q0, vp.IS, ie.U, vp.N / vp.G, -1, ie.scr);
        vp.flags(q0, vp.IS, ie.DN, vp.N / vp.G, -1, ie.scr);
      });
    });
  }

  // At the end of the table: the vector (zero at a position of text) added to the residual, at its scale.
  afterEmb() {
    const p = this.p, s0 = this.P0 - this.PRE, X = s0 + this.pre.x, iv = this.aE + this.M.emb.iv;
    this.slide(this.a.dim, s0 + this.pre.scr, 1, 1, (cc) => p.shl(iv, X, this.a.xUpBits, [cc.sc(0), cc.sc(1)]));
  }

  // The vision part runs before the prompt is read; it counts the vectors it leaves for the text model.
  runVision() {
    this.vp.emitRun();
    this.p.addBig(this.vp.IQ + this.vp.ie.T, this.vp.N / this.vp.G, [this.vp.IQ + this.vp.ie.T + 1, this.vp.IQ + this.vp.ie.T + 2]);
  }

  // The tape reaches to the end of the vision part; its resting cells, in virtual addresses, are those of resting().
  layout() {
    const L = super.layout(), N = this.N, rest = this.vp.resting().map(([lo, hi]) => [N - hi, N - lo]).sort((u, w) => u[0] - w[0]);
    const inRest = (cell) => { for (const [lo, hi] of rest) if (cell >= lo && cell <= hi) return true; return false; };
    return { ...L, tapeSize: this.tapeEnd, engineCells: N + 1, vision: this.vp, visionReal: [N - this.vp.end, N - this.vp.SQ], visionData: inRest };
  }
};

// The bare engine: the text model's weights, the vision part's, then the picture, then the prompt as ids (../engine/pack.js packPrompt).
class VisionEngine extends withVision(Engine) {
  emitReader() { super.emitReader(); this.vp.emitReader(); }
  emitReadPrompt() { this.runVision(); super.emitReadPrompt(); }
}

// The chat program: the text model's weights, the tables of the tokenizer, the vision part's weights (from the end
// next to the tokenizer to the far end, where its run starts), then (the cut) the picture, then the question as text.
// So what the load part reads is three streams: the text model's weights, the tokenizer, the vision part's weights.
class VisionChatProgram extends withVision(ChatProgram) {
  build() {
    const r = super.build(), tok = r.layout.tokData, vis = r.layout.visionData;
    r.layout = { ...r.layout, tapeSize: this.tapeEnd, planSplit: this.planSplit, tokData: (cell) => tok(cell) || vis(cell) };
    return r;
  }

  emitReadPrompt() {
    const { gl, tok: L, glue } = this, R = (v) => this.R(v);
    this.real((q) => T.emitLoad(q, L));
    this.planSplit = this.plan.length;                // the plan of the vision part's weights starts here
    this.vp.emitReader();
    this.cut = { chars: this.p.code.chars, pointer: this.R(this.p.ptr) };
    this.runVision();
    this.real((q) => {
      T.emitEncode(q, L);
      q.move(L.count, R(gl.PN));
      q.addConst(R(gl.REM), this.a.maxTokens, glue.TMP);
    });
  }
}

// The values the weight stream needs on top of the text engine's (../engine/pack.js kinds): the vision part's, and
// the row of <|image_pad|> in the embedding table as zeros (the output layer keeps its row).
function visionKind(vp, vnet, lmNet) {
  return {
    values: (arch, net, layout) => {
      const v = vp.values(vnet), dim = arch.dim, E = (lmNet || net).emb, OFFE = layout.OFFE, img = vp.V.imageToken;
      return { mats: { ...v.mats, emb: (l, r, c) => (r === img ? 0 : E[r * dim + (dim - 1 - c)]) + OFFE }, strips: v.strips };
    },
  };
}

module.exports = { visionArch, withVision, VisionEngine, VisionChatProgram, visionKind };
