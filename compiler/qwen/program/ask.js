'use strict';

// Ask a Qwen2.5 chat model a question.

const fs = require('fs');
const { files, questionBytes, num, gib } = require('./common');
const { session, compileProgram, runWithData, runPure, pieceTimes } = require('./run');

function main() {
  const a = process.argv.slice(2), opt = (name, d) => { const i = a.indexOf(name); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = (name) => { const i = a.indexOf(name); if (i < 0) return false; a.splice(i, 1); return true; };
  const useData = flag('--data'), max = +opt('--max', 0);
  const has = (m) => fs.existsSync(useData ? files(m).program : files(m).pure);
  const model = opt('--model', has('1.5b') ? '1.5b' : '0.5b'), FILES = files(model);
  const question = a.join(" ") || "What is the capital of France?";
  const file = useData ? FILES.program : FILES.pure, metaFile = useData ? FILES.meta : FILES.pureMeta;
  if (!fs.existsSync(file) || !fs.existsSync(metaFile)) throw new Error(`${file} is missing: build it first (see README.md)`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')), input = questionBytes(question, meta.maxQuestionBytes);
  const tty = process.stderr.isTTY, dec = new TextDecoder('utf-8');
  const S = session(meta.tapeSize);
  console.error(`Q: ${question}`);
  const name = model === 'coder-0.5b' ? 'Qwen2.5-Coder-0.5B-Instruct, taught brainfuck,' : `Qwen2.5-${model.toUpperCase()}-Instruct`;
  console.error(`[${name} as ${num(meta.programBytes)} characters of brainfuck; tape ${gib(meta.tapeSize * 4)}, ${S.bits}-bit memory]`);
  const onOutput = (bytes) => { const s = dec.decode(bytes, { stream: true }); if (s) fs.writeSync(1, s); };
  let r, startup;
  if (useData) {
    const exe = compileProgram(S, fs.readFileSync(file));
    fs.writeSync(1, 'A: ');
    r = runWithData(S, exe, [FILES.weights, FILES.tokenizer], input, { onOutput, stopAfterPieces: max });
    startup = r.seconds.load;
    fs.writeSync(1, '\n');
    console.error(`[input: the data files (${num(r.dataBytes)} bytes, read in ${startup.toFixed(1)} s) and then the ${input.length} bytes of the question and its newline]`);
  } else {
    r = runPure(S, file, input, {
      onOutput, stopAfterPieces: max,
      onProgress: (at, total) => { if (tty) process.stderr.write(`\rrunning the program text: ${(at / 2 ** 30).toFixed(2)} of ${(total / 2 ** 30).toFixed(2)} GiB `); },
      onStart: (s) => { if (tty) process.stderr.write('\r' + ' '.repeat(60) + '\r'); console.error(`[start-up ${(s.stream + s.compile).toFixed(1)} s: the program wrote its own weights (${s.stream.toFixed(1)} s of brainfuck executed from disk), its last part was compiled in ${s.compile.toFixed(1)} s]`); fs.writeSync(1, 'A: '); },
    });
    startup = r.seconds.startup;
    fs.writeSync(1, '\n');
    console.error(`[input: the ${input.length} bytes of the question and its newline, nothing else: the question is the program's only input]`);
  }
  const pt = pieceTimes(r.marks);
  console.error(`[start-up ${startup.toFixed(1)} s; first word piece after ${r.marks.length ? r.marks[0].toFixed(1) : '-'} s (the question's tokens pass through the model first); ${r.marks.length} word pieces, ` +
    `${pt ? pt.median.toFixed(2) : '-'} s per word piece (median); whole run ${r.seconds.total.toFixed(1)} s${r.aborted ? `; stopped by --max ${max}` : ''}]`);
}

try { main(); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
