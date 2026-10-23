'use strict';

// ONE brainfuck program: question in (text), answer out (text).

const { Engine } = require('../engine/gen');
const { Patterns } = require('../../../site/runtime/patterns');
const T = require('../tokenizer/gen');
const { switchOn } = require('../../core/switch');

const GLUE = 16;                       // cells between the engine and the tokenizer (ours)
const swap = (code) => code.replace(/[<>]/g, (ch) => (ch === '<' ? '>' : '<'));

class ChatProgram extends Engine {
  constructor(arch, tokOptions = {}) {
    super(arch);
    const N = this.N;
    this.tok = T.layout(N + GLUE, tokOptions);
    // our own cells, in real addresses (N + 1 stays empty)
    const g = (i) => N + 2 + i;
    this.glue = { LEAD: g(0), GO: g(1), F: g(2), A: g(3), B: g(4), TMP: g(5), CNT: g(6), TRASH: g(7) };
  }

  // Real cell of a virtual address of the engine.
  R(v) { return this.N - v; }

  // fn writes code in real addresses; swapped here, since build() mirrors the whole program at the end.
  real(fn) {
    const p = this.p, q = new Patterns(32);
    q.ptr = this.R(p.ptr);
    fn(q);
    p.raw(swap(q.toString()));
    p.ptr = this.R(q.ptr);
  }

  // q.read that skips blanks (9, 11, 12, 13, 32) while LEAD is set, i.e. before the first other character.
  skipLeadingBlanks(q) {
    const { LEAD, GO, F, A, B, TMP } = this.glue, plain = Patterns.prototype.read;
    q.read = (cell) => {
      q.add(GO, 1);
      q.loop(GO, () => {
        q.add(GO, -1);
        plain.call(q, cell);
        q.copy(LEAD, F, TMP);
        q.loop(F, () => {
          q.add(F, -1);
          q.copy(cell, A, TMP);
          const blank = () => { q.clear(cell); q.add(GO, 1); };
          switchOn(q, A, B, [9, 11, 12, 13, 32].map((ch) => [ch, blank]), TMP, { otherwise: () => q.clear(LEAD) });
        });
      });
      return q;
    };
  }

  // pure/gen.js notes here where the loading of the data ends
  afterLoad() {}

  // ---- the three methods of the engine that are replaced -------------------------

  emitReadPrompt() {
    const { gl, tok: L, glue } = this, R = (v) => this.R(v);
    this.real((q) => {
      T.emitLoad(q, L);
      this.afterLoad(q);
      q.add(glue.LEAD, 1);
      this.skipLeadingBlanks(q);
      T.emitEncode(q, L);
      delete q.read;
      q.clear(glue.LEAD);                               // (an empty line never cleared it)
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
        () => this.real((q) => T.emitPrint(q, this.tok, this.R(gl.TOKEN), this.R(t0))));
    });
  }

  build() {
    const { src, layout } = super.build(), L = this.tok;
    return {
      src,
      layout: {
        ...layout,
        tapeSize: L.tapeSize, engineCells: this.N + 1, tok: L,
        tokData: (cell) => cell >= L.base && L.isData(cell),
      },
    };
  }
}

function buildChat(arch, tokOptions) { return new ChatProgram(arch, tokOptions).build(); }

module.exports = { buildChat, ChatProgram };
