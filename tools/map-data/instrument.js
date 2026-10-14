'use strict';
// Generates the program text of the engine again, noting where every named step ends up.
const path = require('path');
const { ROOT } = require('./models');
const { Patterns } = require(path.join(ROOT, 'site', 'runtime', 'patterns'));
const { Emitter } = require(path.join(ROOT, 'site', 'runtime', 'emit'));

function family(model) {
  if (model === 'small') {
    const { buildSplit, SplitProgram } = require(path.join(ROOT, 'compiler', 'smollm', 'pure', 'gen'));
    const { realArch } = require(path.join(ROOT, 'compiler', 'smollm', 'engine', 'real'));
    const { TOK } = require(path.join(ROOT, 'compiler', 'smollm', 'program', 'build'));
    return {
      Engine: require(path.join(ROOT, 'compiler', 'smollm', 'engine', 'gen')).Engine, T: require(path.join(ROOT, 'compiler', 'smollm', 'tokenizer', 'gen')),
      ChatProgram: require(path.join(ROOT, 'compiler', 'smollm', 'program', 'gen')).ChatProgram, Top: SplitProgram,
      make: () => buildSplit(realArch(), TOK, { check: false }),
    };
  }
  const C = require(path.join(ROOT, 'compiler', 'qwen', 'program', 'common')), { ChatProgram } = require(path.join(ROOT, 'compiler', 'qwen', 'program', 'gen'));
  return {
    Engine: require(path.join(ROOT, 'compiler', 'qwen', 'engine', 'gen')).Engine, T: require(path.join(ROOT, 'compiler', 'qwen', 'tokenizer', 'gen')),
    ChatProgram, Top: ChatProgram, make: () => C.generate(model),
  };
}

function build(model = 'small') {
  const { Engine, T, ChatProgram, Top, make } = family(model);
  const marks = [];                 // { kind, name, code (the code array), from, to, depth, info }
  let nest = 0;
  const wrap = (proto, name, kind, info) => {
    const orig = proto[name];
    if (typeof orig !== 'function') throw new Error('no method ' + name);
    proto[name] = function (...args) {
      const p = this.code ? this : this.p, m = { kind, name, code: p.code, from: p.code.length, depth: nest, info: info ? info.apply(this, args) : null };
      nest++;
      try { return orig.apply(this, args); } finally { nest--; m.to = p.code.length; marks.push(m); }
    };
    return () => { proto[name] = orig; };
  };
  const undo = [];
  undo.push(wrap(Engine.prototype, 'S', 'stage', (name) => name));
  const INFO = {
    sweep: (org, M) => ({ rows: M.R, cols: M.C, bits: M.nb }), unsweep: (a, M) => ({ rows: M.R, cols: M.C }),
    slide: (n, base, dir, stride) => ({ n, stride, dir }), stripRight: (l, dist) => ({ dist }), stripRight4: (l, dist) => ({ dist }),
    mul: (a, nb, triples) => ({ bits: nb, products: triples.length }), bitCount: (src, m) => ({ bits: m }),
    rqN: (X, Y, o) => ({ shift: o.k, bits: o.n }), rqSplit: (X, L, T2, o) => ({ shift: o.k, bits: o.n }),
    switchTree: (x, n) => ({ bits: n }), lookupBig: (x, y, y2, table) => ({ entries: table.length }),
    peel: (Z, o) => ({ bits: o.m }), lookup: (x, y, table) => ({ entries: table.length }), mulAcc: (a, nb, pairs) => ({ bits: nb, products: pairs.length }),
    requantCore: (X, outs, k, n) => ({ shift: k, bits: n }),
  };
  for (const n of ['sweep', 'unsweep', 'sweepEmb', 'slide', 'stripRight', 'stripRight4', 'mul', 'bitCount', 'rqN', 'rqSplit', 'switchTree', 'lookupBig', 'ifElse', 'ifElseNZ', 'encode']) undo.push(wrap(Engine.prototype, n, 'idiom', INFO[n]));
  for (const n of ['peel', 'lookup', 'mulAcc', 'requantCore', 'shl', 'addBig', 'argmax', 'splitDigits']) undo.push(wrap(Patterns.prototype, n, 'idiom', INFO[n]));
  for (const n of ['copy', 'move', 'scatter', 'clear']) undo.push(wrap(Emitter.prototype, n, 'idiom'));
  // the tokenizer's parts are functions of the module, called as T.emitX(q, L, ...)
  for (const n of ['emitLoad', 'emitEncode', 'emitPopId', 'emitPrint']) {
    const orig = T[n];
    T[n] = function (q, ...rest) {
      const m = { kind: 'tok', name: n, code: q.code, from: q.code.length, depth: nest };
      nest++;
      try { return orig.call(this, q, ...rest); } finally { nest--; m.to = q.code.length; marks.push(m); }
    };
    undo.push(() => { T[n] = orig; });
  }
  // a piece written in real addresses has its own code list, appended to the engine's as one string
  const chunks = [];
  const origReal = ChatProgram.prototype.real;
  ChatProgram.prototype.real = function (fn) {
    let qcode = null;
    const at = this.p.code.length;
    origReal.call(this, (q) => { qcode = q.code; fn(q); });
    chunks.push({ code: qcode, at, main: this.p.code });
  };
  undo.push(() => { ChatProgram.prototype.real = origReal; });

  let prog = null;
  const origBuild = Top.prototype.build;
  Top.prototype.build = function () { prog = this; return origBuild.call(this); };
  undo.push(() => { Top.prototype.build = origBuild; });

  const S = make();
  undo.forEach((u) => u());

  // code-list index -> character offset
  const main = prog.p.code, sums = new Map();
  const prefix = (code) => {
    let s = sums.get(code);
    if (!s) { s = new Float64Array(code.length + 1); for (let i = 0; i < code.length; i++) s[i + 1] = s[i] + code[i].length; sums.set(code, s); }
    return s;
  };
  const mainSum = prefix(main), chunkOf = new Map(chunks.map((c) => [c.code, c]));
  const out = [];
  for (const m of marks) {
    let from, to;
    if (m.code === main) { from = mainSum[m.from]; to = mainSum[m.to]; }
    else {
      const c = chunkOf.get(m.code);
      if (!c) continue;
      const s = prefix(m.code), base = mainSum[c.at];
      from = base + s[m.from]; to = base + s[m.to];
    }
    if (to > from) out.push({ kind: m.kind, name: m.name, from, to, depth: m.depth, info: m.info });
  }
  if (mainSum[main.length] !== S.src.length) throw new Error('offsets do not add up');
  return { ...S, marks: out, engine: prog };
}

function sections(G) {
  const L = G.loadSrc.length, total = G.restSrc.length;
  const stages = G.marks.filter((m) => m.kind === 'stage').sort((a, b) => a.from - b.from);
  const enc = G.marks.find((m) => m.kind === 'tok' && m.name === 'emitEncode');
  const list = [{ id: 'ask', from: 0 }, { id: 'queue', from: enc.to - L }];
  for (const s of stages) list.push({ id: s.info, from: null, start: s.from - L, end: s.to - L });
  for (let i = 2; i < list.length; i++) list[i].from = i === 2 ? list[i].start : list[i - 1].end;
  list.forEach((s, i) => { s.to = i + 1 < list.length ? list[i + 1].from : total; delete s.start; delete s.end; });
  for (const s of list) if (!(s.to > s.from)) throw new Error('empty section ' + s.id);
  return list;
}

module.exports = { build, sections };
