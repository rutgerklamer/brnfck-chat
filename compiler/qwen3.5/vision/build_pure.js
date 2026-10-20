'use strict';

// Builds site/programs/brnfck-qwen3.5-0.8b-vision.bf: ONE brainfuck program, a picture and a question in, the answer
// out, no data file. As ../program/build_pure.js: the load part of the program of build.js run on its three streams,
// the tape it leaves written as brainfuck that writes it, and the rest of the program after it.
//   node compiler/qwen3.5/vision/build_pure.js

const path = require('path');
const { buildPure } = require('../program/build_pure');
const { NAME, FILES, DATA, SIDE, generate } = require('./build');

const PURE = { program: path.join(__dirname, '..', '..', '..', 'site', 'programs', 'brnfck-qwen3.5-0.8b-vision.bf') };
PURE.meta = PURE.program.replace(/\.bf$/, '.meta.json');

const main = () => buildPure({
  generate, data: DATA, programFile: FILES.program, PURE,
  meta: { head: { model: NAME, vision: true }, tail: { pictureSide: SIDE, pictureBytes: SIDE * SIDE * 3, maxQuestionBytes: 200 } },
});

module.exports = { PURE };
if (require.main === module) main();
