'use strict';

// The chat program of ../program/gen.js, cut in two at the moment its data has been read.

const { ChatProgram, buildChat } = require('../program/gen');

class SplitProgram extends ChatProgram {
  afterLoad(q) { this.split = { chars: this.p.toString().length + q.toString().length, pointer: q.ptr }; }
}

function buildSplit(arch, tokOptions, options = {}) {
  const prog = new SplitProgram(arch, tokOptions), { src, layout } = prog.build();
  if (options.check !== false && src !== buildChat(arch, tokOptions).src) throw new Error('the split program is not the program of compiler/smollm/program/gen.js');
  const { chars, pointer } = prog.split, loadSrc = src.slice(0, chars), restSrc = src.slice(chars);
  const depth = (s) => { let d = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 91) d++; else if (c === 93) d--; } return d; };
  if (depth(loadSrc) !== 0) throw new Error('the cut is inside a loop');
  if (restSrc.length < 1000 || loadSrc.includes('.')) throw new Error('unexpected split');
  return { src, loadSrc, restSrc, pointer, layout };
}

module.exports = { buildSplit, SplitProgram };
