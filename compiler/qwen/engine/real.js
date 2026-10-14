'use strict';

// A real model's ARCHITECTURE without its weights: enough to generate the program text.

const path = require('path');
const Spec = require('./spec');
const { archOf } = require('./gen');

const OUT = path.join(__dirname, 'out');           // program, weight stream and reference data are written here
const files = (name) => ({
  program: path.join(OUT, `qwen-${name}.bf`), meta: path.join(OUT, `qwen-${name}.meta.json`),
  weights: path.join(OUT, `weights-${name}.bin`), ref: path.join(OUT, `ref-${name}.json`),
});
const realArch = (name) => archOf(Spec.shapeOf(name), Spec.optionsFor(name));

module.exports = { realArch, OUT, files };
