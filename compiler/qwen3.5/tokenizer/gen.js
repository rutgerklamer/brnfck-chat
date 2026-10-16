'use strict';

// Text front and back end for Qwen3.5: the tokenizer of compiler/qwen/tokenizer/gen.js with the options of Qwen3.5.

const Q = require('../../qwen/tokenizer/gen');

const DEFAULTS = {
  ...Q.DEFAULTS,
  hiBits: 7, midBits: 7, loBits: 5,   // record number = (hi, mid, lo); together 19 bits
  slotBits: 19,             // twice as many slots as merges, so a probe ends soon
  maxPre: 4,                // room for the template tokens before the question
  maxSuf: 12,               // ... and after it
  subTables: 600,           // room for the class tables of multi-byte characters (64 entries each)
  subBytes: 2,              // (600 tables: their numbers take two bytes)
};

const SLOT_BITS = DEFAULTS.slotBits;
const S_BYTE = 1 << SLOT_BITS, S_PAIR = 1 << (SLOT_BITS + 1);

const layout = (base = 0, opts = {}) => Q.layout(base, { ...DEFAULTS, ...opts });

module.exports = { ...Q, DEFAULTS, SLOT_BITS, S_BYTE, S_PAIR, layout };
