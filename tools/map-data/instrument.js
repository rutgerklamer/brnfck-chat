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
  if (model === '0.8b' || model === '0.8b-vision') {
    // Qwen3.5: the engine notes its own named steps (layout().marks); its text is kept in pieces that count their characters.
    // The vision part of the picture program notes its steps in the same list, with the kind 'vision'.
    const { ChatProgram } = require(path.join(ROOT, 'compiler', 'qwen3.5', 'program', 'gen')), vision = model === '0.8b-vision';
    return {
      Engine: require(path.join(ROOT, 'compiler', 'qwen3.5', 'engine', 'gen')).Engine, T: require(path.join(ROOT, 'compiler', 'qwen3.5', 'tokenizer', 'gen')),
      ChatProgram, Top: vision ? require(path.join(ROOT, 'compiler', 'qwen3.5', 'vision', 'program')).VisionChatProgram : ChatProgram,
      make: () => require(path.join(ROOT, 'compiler', 'qwen3.5', vision ? 'vision' : 'program', 'build')).generate(), ownStages: true,
    };
  }
  const C = require(path.join(ROOT, 'compiler', 'qwen', 'program', 'common')), { ChatProgram } = require(path.join(ROOT, 'compiler', 'qwen', 'program', 'gen'));
  return {
    Engine: require(path.join(ROOT, 'compiler', 'qwen', 'engine', 'gen')).Engine, T: require(path.join(ROOT, 'compiler', 'qwen', 'tokenizer', 'gen')),
    ChatProgram, Top: ChatProgram, make: () => C.generate(model),
  };
}

function build(model = 'small') {
  const { Engine, T, ChatProgram, Top, make, ownStages } = family(model);
  const marks = [];                 // { kind, name, code (the code array), from, to, depth, info }
  let nest = 0;
  // where a code list is now: the number of its pieces, or its characters when it counts them (Qwen3.5)
  const here = (code) => (code.chars !== undefined ? code.chars : code.length);
  const wrap = (proto, name, kind, info) => {
    const orig = proto[name];
    if (typeof orig !== 'function') throw new Error('no method ' + name);
    proto[name] = function (...args) {
      const p = this.code ? this : this.p, m = { kind, name, code: p.code, from: here(p.code), depth: nest, info: info ? info.apply(this, args) : null };
      nest++;
      try { return orig.apply(this, args); } finally { nest--; m.to = here(p.code); marks.push(m); }
    };
    return () => { proto[name] = orig; };
  };
  const undo = [];
  if (!ownStages) undo.push(wrap(Engine.prototype, 'S', 'stage', (name) => name));
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
      const m = { kind: 'tok', name: n, code: q.code, from: here(q.code), depth: nest };
      nest++;
      try { return orig.call(this, q, ...rest); } finally { nest--; m.to = here(q.code); marks.push(m); }
    };
    undo.push(() => { T[n] = orig; });
  }
  // a piece written in real addresses has its own code list, appended to the engine's as one string
  const chunks = [];
  const origReal = ChatProgram.prototype.real;
  ChatProgram.prototype.real = function (fn) {
    let qcode = null;
    const at = here(this.p.code);
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
  const main = prog.p.code, sums = new Map(), counted = main.chars !== undefined;
  const prefix = (code) => {
    let s = sums.get(code);
    if (!s) { s = new Float64Array(code.length + 1); for (let i = 0; i < code.length; i++) s[i + 1] = s[i] + code[i].length; sums.set(code, s); }
    return s;
  };
  const mainAt = counted ? (i) => i : (i) => prefix(main)[i], chunkOf = new Map(chunks.map((c) => [c.code, c]));
  const out = [];
  for (const m of marks) {
    let from, to;
    if (m.code === main) { from = mainAt(m.from); to = mainAt(m.to); }
    else {
      const c = chunkOf.get(m.code);
      if (!c) continue;
      const s = prefix(m.code), base = mainAt(c.at);
      from = base + s[m.from]; to = base + s[m.to];
    }
    if (to > from) out.push({ kind: m.kind, name: m.name, from, to, depth: m.depth, info: m.info });
  }
  if (ownStages) {
    // the named steps the engine noted itself, with the kind of layer and its place in the group of layers
    for (const m of S.layout.marks) out.push({ kind: 'stage', name: m.name, from: m.start, to: m.end, depth: 0, info: m.name, layerKind: m.kind, u: m.u });
    // (the rest of the picture program is longer than a string can be: it is kept in its pieces)
    S.restLength = S.restChunks.reduce((n, c) => n + c.length, 0);
    if (S.restLength < 2 ** 28) { S.restSrc = S.restChunks.join(''); S.restChunks = null; }
    S.chunks = null;
  }
  if ((counted ? main.chars : prefix(main)[main.length]) !== (counted ? S.length : S.src.length)) throw new Error('offsets do not add up');
  return { ...S, marks: out, engine: prog };
}

// The steps of the Qwen3.5 engine that hold other steps: the heads of a DeltaNet layer are shown by their parts,
// the heads of an attention layer as one step (its one part, the gain, is short).
const nested = (m) => (m.name === 'heads' && m.layerKind === 'lin') || (m.name === 'gain' && m.layerKind === 'att');
// The name a step has on the pages: a step that does the same in every layer keeps its name; a step of a DeltaNet
// layer that does something else than the step of that name in an attention layer gets a name of its own.
const DN_OWN = new Set(['sweep1', 'round', 'conv', 'qk', 'load', 'decay', 'vq', 'predict', 'delta', 'write', 'read', 'next', 'gated', 'sweep2', 'xatt']);
const keyOf = (m) => (m.layerKind === 'lin' && DN_OWN.has(m.name) ? 'dn.' + m.name : m.name);

function sections(G) {
  const L = G.loadSrc.length, total = G.restSrc ? G.restSrc.length : G.restLength;
  const stages = G.marks.filter((m) => m.kind === 'stage' && !nested(m)).sort((a, b) => a.from - b.from);
  const enc = G.marks.find((m) => m.kind === 'tok' && m.name === 'emitEncode');
  // A section starts where the step before it ended (the code between two steps goes with the second), at the start of
  // its own step when the section before it has no step, or at a fixed place.
  const list = [];
  // The picture program: its vision part runs first, before the question is read. A round of it is the second half of
  // one layer and the first half of the next, written out for every round; a round starts at the step 'fetch'.
  const vis = stages.filter((s) => s.layerKind === 'vision');
  if (vis.length) {
    list.push({ id: 'vstart', from: 0 });
    let round = 0;
    for (const s of vis) {
      if (s.name === 'fetch') round++;
      list.push({ id: 'v' + round + '.' + s.name, key: 'v.' + s.name, round, layerKind: 'vision', start: s.from - L, end: s.to - L });
    }
    list.push({ id: 'vend' });
  }
  list.push({ id: 'ask', from: vis.length ? enc.from - L : 0 }, { id: 'queue', from: enc.to - L });
  for (const s of stages) {
    if (s.layerKind === 'vision') continue;
    if (s.u === undefined || s.u === null) list.push({ id: s.info, start: s.from - L, end: s.to - L });
    // a step of the group of layers of Qwen3.5: its text is written once for each place in the group
    else list.push({ id: 'u' + s.u + '.' + s.name, key: keyOf(s), u: s.u, layerKind: s.layerKind, start: s.from - L, end: s.to - L });
  }
  list.forEach((s, i) => { if (s.from === undefined) s.from = i && list[i - 1].end !== undefined ? list[i - 1].end : s.start; });
  list.forEach((s, i) => { s.to = i + 1 < list.length ? list[i + 1].from : total; delete s.start; delete s.end; });
  for (const s of list) if (!(s.to > s.from)) throw new Error('empty section ' + s.id);
  return list;
}

module.exports = { build, sections };
