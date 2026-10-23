'use strict';

// ONE brainfuck program for a Qwen2.5 chat model: question in (text), answer out (text).

const { Engine } = require('../engine/gen');
const { Patterns } = require('../../../site/runtime/patterns');
const T = require('../tokenizer/gen');

const GLUE = 16;                       // cells between the engine and the tokenizer
const swap = (code) => code.replace(/[<>]/g, (ch) => (ch === '<' ? '>' : '<'));

class ChatProgram extends Engine {
  constructor(arch, tokOptions = {}) {
    super(arch);
    const N = this.N;
    this.tok = T.layout(N + GLUE, tokOptions);
    // the glue cells, in real addresses (N + 1 stays empty)
    const g = (i) => N + 2 + i;
    this.glue = { TMP: g(0), CNT: g(1), TRASH: g(2) };
    this.cut = null;
  }

  // Real cell of a virtual address of the engine.
  R(v) { return this.N - v; }

  real(fn) {
    const p = this.p, q = new Patterns(32);
    q.ptr = this.R(p.ptr);
    fn(q);
    p.raw(swap(q.toString()));
    p.ptr = this.R(q.ptr);
  }

  // ---- the three methods of the engine that are replaced -------------------------

  emitReadPrompt() {
    const { gl, tok: L, glue } = this, R = (v) => this.R(v);
    this.real((q) => {
      T.emitLoad(q, L);
      this.cut = { chars: this.p.toString().length + q.toString().length, pointer: q.ptr };
      T.emitEncode(q, L);
      q.move(L.count, R(gl.PN));
      q.copy(R(gl.POS), glue.CNT, glue.TMP);
      q.loop(glue.CNT, () => {
        q.add(glue.CNT, -1);
        T.emitPopId(q, L, glue.TRASH); q.clear(glue.TRASH);
        q.add(R(gl.PN), -1);
      });
      q.addConst(R(gl.REM), this.a.maxTokens, glue.TMP);
      q.copy(R(gl.POS), glue.CNT, glue.TMP);
      q.scatter(glue.CNT, [[R(gl.REM), -1]]);
    });
  }

  // If prompt ids are left: TOKEN = the next one.
  emitTakePrompt() {
    const { p, gl } = this;
    p.whenNonZero(gl.PN, [gl.T, gl.T + 1], () => {
      p.clear(gl.TOKEN);
      this.real((q) => T.emitPopId(q, this.tok, this.R(gl.TOKEN)));
      p.add(gl.PN, -1);
    });
  }

  emitFeedAndPrint(id) {
    const { p, gl } = this, c = (i) => gl.PRT + i, [t0, t1, flag, v, e, hit, E2] = Array.from({ length: 7 }, (_, i) => c(i)), hop = [c(8), c(9)];
    p.clear(gl.TOKEN).move(id, gl.TOKEN);
    p.whenZero(gl.PN, [t0, t1, flag], () => {
      for (const s of this.a.stops) {                   // hit = 1 when the token is an end token
        p.copy(gl.TOKEN, v, t0); p.addBig(v, -s, hop);
        p.add(e, 1); p.ifNonZero(v, () => p.add(e, -1)); p.move(e, hit);
      }
      this.ifElse(hit, E2, () => p.clear(gl.REM),
        () => this.real((q) => T.emitPrint(q, this.tok, this.R(gl.TOKEN), { tmp: this.R(t0) })));
    });
  }

  build() {
    const { src, layout } = super.build(), L = this.tok;
    // the load part reads the data files, the rest the question; the cut lies outside every loop, before any output
    const { chars, pointer } = this.cut, loadSrc = src.slice(0, chars), restSrc = src.slice(chars);
    let depth = 0;
    for (let i = 0; i < loadSrc.length; i++) { const ch = loadSrc.charCodeAt(i); if (ch === 91) depth++; else if (ch === 93) depth--; }
    if (depth !== 0) throw new Error('the cut is inside a loop');
    if (loadSrc.includes('.')) throw new Error('the load part prints');
    return {
      src, loadSrc, restSrc, pointer,
      layout: {
        ...layout,
        tapeSize: L.tapeSize, engineCells: this.N + 1, tok: L,
        tokData: (cell) => cell >= L.base && L.isData(cell),
      },
    };
  }
}

function buildChat(arch, tokOptions) { return new ChatProgram(arch, tokOptions).build(); }

// Real cells that are not zero although they should be, after a run that ended by itself.
function dirtyCells(tape, layout, limit = 5) {
  const N = layout.engineCells - 1, dirty = [];
  let v = 0;
  for (const [lo, hi] of [...layout.allowedRanges(), [N + 1, N + 1]]) {
    for (; v < lo && dirty.length < limit; v++) if (tape[N - v] !== 0) dirty.push(N - v);
    v = Math.max(v, hi + 1);
  }
  for (let cell = N + 1; cell < layout.tapeSize && dirty.length < limit; cell++) if (tape[cell] !== 0 && !layout.tokData(cell)) dirty.push(cell);
  return dirty;
}

module.exports = { buildChat, ChatProgram, dirtyCells };
