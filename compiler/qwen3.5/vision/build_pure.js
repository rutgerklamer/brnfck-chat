'use strict';

// Builds site/programs/brnfck-qwen3.5-0.8b-vision.bf, ONE program with no data file (picture and question in, answer out),
// as ../program/build_pure.js does: from the load part of build.js's program run on its three streams.

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
