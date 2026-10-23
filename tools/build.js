'use strict';
// One program from the downloaded model files to a checked brainfuck file, in one command.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GB = 2 ** 30;
const gb = (n) => (n / GB).toFixed(1) + ' GiB';
const num = (n) => Math.round(n).toLocaleString('en-US');

// The model files, exactly as Hugging Face serves them (name, bytes).
const DOWNLOADS = {
  small: { repo: 'HuggingFaceTB/SmolLM2-135M-Instruct', dir: 'compiler/downloads/smollm2-135m', files: [['config.json', 861], ['model.safetensors', 269060552], ['tokenizer.json', 2104556], ['tokenizer_config.json', 3764]] },
  '0.5b': { repo: 'Qwen/Qwen2.5-0.5B-Instruct', dir: 'compiler/downloads/qwen2.5-0.5b', files: [['config.json', 659], ['generation_config.json', 242], ['model.safetensors', 988097824], ['tokenizer.json', 7031645], ['tokenizer_config.json', 7305]] },
  '0.8b': { repo: 'Qwen/Qwen3.5-0.8B', dir: 'compiler/downloads/qwen3.5-0.8b', files: [['config.json', 2907], ['model.safetensors', 1746942600], ['tokenizer.json', 12807982], ['tokenizer_config.json', 16709]] },
  '0.8b-vision': { repo: 'Qwen/Qwen3.5-0.8B', dir: 'compiler/downloads/qwen3.5-0.8b', files: [['config.json', 2907], ['model.safetensors', 1746942600], ['tokenizer.json', 12807982], ['tokenizer_config.json', 16709]] },
  'coder-0.5b': { repo: 'Qwen/Qwen2.5-Coder-0.5B-Instruct', dir: 'compiler/downloads/qwen2.5-coder-0.5b', files: [['config.json', 659], ['generation_config.json', 243], ['model.safetensors', 988097824], ['tokenizer.json', 7031645], ['tokenizer_config.json', 7305]] },
  '1.5b': { repo: 'Qwen/Qwen2.5-1.5B-Instruct', dir: 'compiler/downloads/qwen2.5-1.5b', files: [['config.json', 660], ['generation_config.json', 242], ['model.safetensors', 3087467144], ['tokenizer.json', 7031645], ['tokenizer_config.json', 7305]] },
};

// The steps of each build in order; mem: free memory needed, disk: written, spare: to keep free after it, all in GiB.
const STEPS = {
  small: [
    { run: ['compiler/smollm/engine/build_real.js'], mem: 2, disk: 0.4, time: 'about 2 minutes', makes: 'compiler/smollm/engine/out/weights.bin (354 MB), chat.bf, ref.json', what: 'load the model as whole numbers, write the weight stream and the reference answers of the engine' },
    { run: ['compiler/smollm/program/build.js'], mem: 1, disk: 0.4, time: 'seconds', needs: ['compiler/smollm/engine/out/weights.bin'], makes: 'compiler/smollm/program/out/chat.bf (31 MB), chat.dat (356 MB)', what: 'the program that still reads its weights as input, and its data file' },
    { run: ['compiler/smollm/program/make_ref.js'], mem: 2, disk: 0, time: 'about 3 minutes', makes: 'compiler/smollm/program/out/ref.json', what: 'the reference answers to the test questions (plain whole-number JavaScript, no brainfuck)' },
    { run: ['compiler/smollm/pure/build.js'], mem: 2, disk: 1.0, spare: 3, time: 'about 2 minutes', needs: ['compiler/smollm/program/out/chat.dat'], makes: 'site/programs/brnfck-smollm2-135m.bf (1,030,902,380 characters) and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape' },
    { verify: true, run: ['compiler/smollm/pure/verify.js'], quick: [['compiler/smollm/pure/verify.js', 'scan'], ['compiler/smollm/pure/verify.js', 'tape'], ['compiler/smollm/pure/verify.js', 'ask', '1']], mem: 3, disk: 0, time: 'about 22 minutes (--quick: about 2)', needs: ['site/programs/brnfck-smollm2-135m.bf', 'compiler/smollm/program/out/ref.json'], pass: 'all 49 ok', what: 'only the 8 commands; written tape = loaded tape (180 checksums); 10 questions against the reference' },
  ],
  '0.5b': [
    { run: ['compiler/qwen/engine/build_real.js', '0.5b'], mem: 2.5, disk: 1.0, time: 'about 2 minutes', makes: 'compiler/qwen/engine/out/weights-0.5b.bin (903 MB), qwen-0.5b.bf, ref-0.5b.json', what: 'load the model as whole numbers, write the weight stream and the reference answers of the engine' },
    { run: ['compiler/qwen/program/build.js', '0.5b'], mem: 1, disk: 0.1, time: 'seconds', makes: 'compiler/qwen/program/out/chat-0.5b.bf (76 MB), tokenizer.bin', what: 'the program that still reads its weights as input' },
    { run: ['compiler/qwen/program/make_ref.js', '0.5b'], mem: 2.5, disk: 0, time: 'about 4 minutes', needs: ['compiler/qwen/engine/out/weights-0.5b.bin'], makes: 'compiler/qwen/program/out/ref-0.5b.json', what: 'the reference answers to the test questions (plain whole-number JavaScript, no brainfuck)' },
    { run: ['compiler/qwen/program/build_pure.js', '0.5b'], mem: 4, disk: 4.2, spare: 8, time: 'about 3 minutes', needs: ['compiler/qwen/program/out/chat-0.5b.bf', 'compiler/qwen/program/out/tokenizer.bin'], makes: 'site/programs/brnfck-qwen2.5-0.5b.bf (4,169,659,608 characters) and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape (peak memory 2.9 GiB)' },
    { verify: true, run: ['compiler/qwen/program/verify_pure.js', '0.5b'], quick: [['compiler/qwen/program/verify_pure.js', '0.5b', 'scan'], ['compiler/qwen/program/verify_pure.js', '0.5b', 'tape'], ['compiler/qwen/program/verify_pure.js', '0.5b', 'ask', '0']], mem: 6.5, disk: 0, time: 'about 11 minutes (--quick: about 4)', needs: ['site/programs/brnfck-qwen2.5-0.5b.bf', 'compiler/qwen/program/out/ref-0.5b.json'], pass: 'all 27 ok', what: 'only the 8 commands; written tape = loaded tape (628 checksums); 4 questions against the reference (peak memory 5.3 GiB)' },
  ],
  '0.8b': [
    { run: ['compiler/qwen3.5/engine/build_real.js'], mem: 4.5, disk: 2.3, time: 'about 8 minutes', makes: 'compiler/qwen3.5/engine/out/qwen3.5-0.8b.bf (286 MB), weights-qwen3.5-0.8b.bin (2.0 GB), ref-qwen3.5-0.8b.json', what: 'load the model as whole numbers (3.5 GiB), write the engine, the weight stream and the reference answers of the spec' },
    { run: ['compiler/qwen3.5/program/build.js'], mem: 1, disk: 0.3, time: 'about a minute', needs: ['compiler/qwen3.5/engine/out/weights-qwen3.5-0.8b.bin'], makes: 'compiler/qwen3.5/program/out/chat-qwen3.5-0.8b.bf (290 MB), tokenizer.bin', what: 'the program that still reads its weights as input' },
    { run: ['compiler/qwen3.5/program/build_pure.js'], mem: 5.5, disk: 7.2, spare: 8, time: 'about 7 minutes', needs: ['compiler/qwen3.5/program/out/chat-qwen3.5-0.8b.bf', 'compiler/qwen3.5/program/out/tokenizer.bin'], makes: 'site/programs/brnfck-qwen3.5-0.8b.bf (7,709,034,855 characters) and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape (peak memory 5.3 GiB)' },
    { verify: true, run: ['compiler/qwen3.5/program/verify_pure.js'], quick: [['compiler/qwen3.5/program/verify_pure.js', 'scan'], ['compiler/qwen3.5/program/verify_pure.js', 'tape']], mem: 5.5, disk: 0, time: 'about 9 minutes (--quick: about 3)', needs: ['site/programs/brnfck-qwen3.5-0.8b.bf', 'compiler/qwen3.5/engine/out/ref-qwen3.5-0.8b.json'], pass: 'all 11 ok', what: 'only the 8 commands; written tape = loaded tape (1,018 checksums); a question against the reference (peak memory 4.9 GiB)' },
  ],
  '0.8b-vision': [
    { run: ['--max-old-space-size=16000', 'compiler/qwen3.5/vision/build.js'], mem: 9, disk: 3.0, time: 'about 15 minutes', makes: 'compiler/qwen3.5/vision/out/chat-vision-qwen3.5-0.8b.bf (785 MB), weights-text-qwen3.5-0.8b.bin (2.0 GB), weights-vision-qwen3.5-0.8b.bin (197 MB), tokenizer-vision.bin, ref-vision-qwen3.5-0.8b.json', what: 'the program with its vision part that still reads its weights as input, its three streams, and the answers of the whole-number recipe about the pictures of compiler/qwen3.5/vision/pictures/' },
    { run: ['--max-old-space-size=16000', 'compiler/qwen3.5/vision/build_pure.js'], mem: 9, disk: 9, spare: 8, time: 'about 7 minutes', needs: ['compiler/qwen3.5/vision/out/chat-vision-qwen3.5-0.8b.bf', 'compiler/qwen3.5/vision/out/weights-vision-qwen3.5-0.8b.bin'], makes: 'site/programs/brnfck-qwen3.5-0.8b-vision.bf (8,931,101,419 characters) and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape (peak memory 8.4 GiB)' },
    { verify: true, run: ['compiler/qwen3.5/vision/verify_pure.js'], quick: [['compiler/qwen3.5/vision/verify_pure.js', 'scan'], ['compiler/qwen3.5/vision/verify_pure.js', 'tape']], mem: 9, disk: 0, time: 'about 18 minutes (--quick: about 3)', needs: ['site/programs/brnfck-qwen3.5-0.8b-vision.bf', 'compiler/qwen3.5/vision/out/ref-vision-qwen3.5-0.8b.json'], pass: 'all 11 ok', what: 'only the 8 commands; written tape = loaded tape; a picture and a question against the reference' },
  ],
  'coder-0.5b': [
    { run: ['compiler/coder/data.js'], mem: 1, disk: 0.1, time: 'seconds', makes: 'compiler/coder/out/train.jsonl (60,000 tasks with a brainfuck program each), test.jsonl', what: 'the training examples: every program run by the checker of site/challenges/ before it is kept' },
    { py: true, run: ['compiler/coder/train.py'], mem: 4, disk: 6, time: 'about an hour on an NVIDIA GPU with 12 GB', needs: ['compiler/coder/out/train.jsonl'], makes: 'compiler/downloads/qwen2.5-coder-0.5b-brainfuck/ (the taught model, 988 MB), and on the way compiler/coder/out/checkpoint.pt (4.8 GB; an unfinished run continues with --resume)', what: 'teach Qwen2.5-Coder-0.5B-Instruct to answer with a brainfuck program (PyTorch in .venv/)' },
    { run: ['compiler/qwen/reference/calibrate.js', '--model=coder-0.5b'], mem: 3, disk: 0, time: 'seconds', needs: ['compiler/downloads/qwen2.5-coder-0.5b-brainfuck/model.safetensors'], makes: 'compiler/qwen/engine/data/coder-0.5b/calib.json', what: 'the keys and values of the fixed start of every conversation, from the taught model' },
    { run: ['compiler/qwen/engine/build_real.js', 'coder-0.5b'], mem: 2.5, disk: 1.0, time: 'about 2 minutes', makes: 'compiler/qwen/engine/out/weights-coder-0.5b.bin (903 MB), qwen-coder-0.5b.bf, ref-coder-0.5b.json', what: 'load the taught model as whole numbers, write the weight stream and the reference answers of the engine' },
    { run: ['compiler/qwen/program/build.js', 'coder-0.5b'], mem: 1, disk: 0.1, time: 'seconds', makes: 'compiler/qwen/program/out/chat-coder-0.5b.bf (76 MB), tokenizer.bin', what: 'the program that still reads its weights as input' },
    { run: ['compiler/qwen/program/make_ref.js', 'coder-0.5b'], mem: 2.5, disk: 0, time: 'about 5 minutes', needs: ['compiler/qwen/engine/out/weights-coder-0.5b.bin'], makes: 'compiler/qwen/program/out/ref-coder-0.5b.json', what: 'the reference answers to six challenges (plain whole-number JavaScript, no brainfuck)' },
    { run: ['compiler/qwen/program/build_pure.js', 'coder-0.5b'], mem: 4, disk: 4.2, spare: 8, time: 'about 3 minutes', needs: ['compiler/qwen/program/out/chat-coder-0.5b.bf', 'compiler/qwen/program/out/tokenizer.bin'], makes: 'site/programs/brnfck-qwen2.5-coder-0.5b.bf and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape' },
    { verify: true, run: ['compiler/qwen/program/verify_pure.js', 'coder-0.5b'], quick: [['compiler/qwen/program/verify_pure.js', 'coder-0.5b', 'scan'], ['compiler/qwen/program/verify_pure.js', 'coder-0.5b', 'tape'], ['compiler/qwen/program/verify_pure.js', 'coder-0.5b', 'ask', '0']], mem: 6.5, disk: 0, time: 'about 15 minutes (--quick: about 5)', needs: ['site/programs/brnfck-qwen2.5-coder-0.5b.bf', 'compiler/qwen/program/out/ref-coder-0.5b.json'], pass: 'all 33 ok', what: 'only the 8 commands; written tape = loaded tape; 4 challenges against the reference' },
  ],
  '1.5b': [
    { run: ['compiler/qwen/program/build.js', '1.5b'], mem: 1, disk: 0.2, time: 'seconds', makes: 'compiler/qwen/program/out/chat-1.5b.bf (106 MB), tokenizer.bin', what: 'the program that still reads its weights as input' },
    { run: ['compiler/qwen/program/make_ref.js', '1.5b'], mem: 4.5, disk: 2.2, time: 'about 10 minutes', makes: 'compiler/qwen/program/out/weights-1.5b.bin (2.2 GB), ref-1.5b.json', what: 'load the model as whole numbers (3.2 GB), write the weight stream and the reference answers' },
    { run: ['compiler/qwen/program/build_pure.js', '1.5b'], mem: 9, disk: 11.7, spare: 8, time: 'about 7 minutes', needs: ['compiler/qwen/program/out/chat-1.5b.bf', 'compiler/qwen/program/out/weights-1.5b.bin'], makes: 'site/programs/brnfck-qwen2.5-1.5b.bf (11,430,468,880 characters) and its meta file', what: 'THE PROGRAM: the load part replaced by code that writes the tape (peak memory 7.5 GiB)' },
    { verify: true, run: ['compiler/qwen/program/verify_pure.js', '1.5b'], quick: [['compiler/qwen/program/verify_pure.js', '1.5b', 'scan'], ['compiler/qwen/program/verify_pure.js', '1.5b', 'tape'], ['compiler/qwen/program/verify_pure.js', '1.5b', 'ask', '0']], mem: 11, disk: 0, time: 'about 30 minutes (--quick: about 10)', needs: ['site/programs/brnfck-qwen2.5-1.5b.bf', 'compiler/qwen/program/out/ref-1.5b.json'], pass: 'all 33 ok', what: 'only the 8 commands; written tape = loaded tape (1,744 checksums); questions against the reference (peak memory 9.9 GiB)' },
  ],
};

// What the full verification prints is kept here: tools/map-data/checks.js reads it.
const VERIFY_LOG = { small: 'compiler/smollm/pure/out/verify.log', '0.5b': 'compiler/qwen/program/out/verify_pure-0.5b.log', '1.5b': 'compiler/qwen/program/out/verify_pure-1.5b.log', '0.8b': 'compiler/qwen3.5/program/out/verify_pure.log', '0.8b-vision': 'compiler/qwen3.5/vision/out/verify_pure.log', 'coder-0.5b': 'compiler/qwen/program/out/verify_pure-coder-0.5b.log' };
// Runs a script and writes what it prints to a file as well as to the screen.
const TEE = "const { spawn } = require('child_process'), fs = require('fs'), path = require('path'); const [log, ...args] = process.argv.slice(1); fs.mkdirSync(path.dirname(log), { recursive: true }); const out = fs.createWriteStream(log); const c = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'inherit'] }); c.stdout.on('data', (d) => { process.stdout.write(d); out.write(d); }); c.on('close', (code) => out.end(() => process.exit(code === null ? 1 : code)));";

// Python with PyTorch, for the one step that teaches a model (README.md, step 3)
const PYTHON = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const dry = flag('--dry-run'), noVerify = flag('--no-verify'), quick = flag('--quick'), force = flag('--force'), from = Number(opt('--from', 1));
const model = argv[0];
if (!STEPS[model]) { console.error('usage: node tools/build.js small|0.5b|1.5b|0.8b|0.8b-vision|coder-0.5b [--dry-run] [--no-verify] [--quick] [--from N] [--force]'); process.exit(1); }

function freeDisk() { try { const s = fs.statfsSync(ROOT); return s.bavail * s.bsize; } catch (e) { return null; } }
let problems = 0;
const problem = (text) => { problems++; console.log('  !! ' + text); };

// ---- the tools and the model files
const major = Number(process.versions.node.split('.')[0]);
console.log(`Node ${process.versions.node}${major < 24 ? '  (the project was built and tested with Node 24; an older one may lack 64-bit WebAssembly memory, which the 1.5B needs)' : ''}`);
const D = DOWNLOADS[model];
console.log(`\nModel files in ${D.dir}/ (from https://huggingface.co/${D.repo}):`);
let missing = 0;
for (const [name, bytes] of D.files) {
  const f = path.join(ROOT, D.dir, name), size = fs.existsSync(f) ? fs.statSync(f).size : -1;
  console.log(`  ${size === bytes ? 'ok     ' : size < 0 ? 'MISSING' : 'SIZE?  '} ${name}  ${num(bytes)} bytes${size >= 0 && size !== bytes ? ` (here: ${num(size)}; a newer or broken download?)` : ''}`);
  if (size < 0) missing++;
}
if (missing) {
  console.log(`\nDownload the missing files into ${D.dir}/ first, each from\n  https://huggingface.co/${D.repo}/resolve/main/<file name>\n(README.md, "2. Download a model", has the commands.)`);
  if (!dry) process.exit(1);
  problems++;
}

// ---- the steps
const steps = STEPS[model].filter((s) => !(s.verify && noVerify));
console.log(`\n${steps.length} steps for "${model}"${dry ? ' (dry run: nothing is run)' : ''}:`);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i], runs = s.verify && quick ? s.quick : [s.run];
  console.log(`\n[${i + 1}/${steps.length}] ${runs.map((r) => (s.py ? PYTHON : 'node') + ' ' + r.join(' ')).join('  &&  ')}`);
  console.log(`      ${s.what}`);
  console.log(`      needs about ${s.mem} GiB of free memory${s.disk ? `, writes about ${s.disk} GiB` : ''}; ${s.time}${s.makes ? `\n      writes ${s.makes}` : ''}${s.pass ? `\n      pass looks like: every check starts with "ok" and the last line is "${quick ? 'all <n> ok' : s.pass}"` : ''}`);
  if (i + 1 < from) { console.log('      (skipped: --from)'); continue; }
  const freeMem = os.freemem(), disk = freeDisk();
  if (freeMem < s.mem * GB) problem(`only ${gb(freeMem)} of memory is free now; this step needs about ${s.mem} GiB. Close other programs (browser tabs with a chat page take 1.5 to 8 GB).`);
  if (disk !== null && s.disk && disk < (s.disk + (s.spare || 1)) * GB) problem(`only ${gb(disk)} is free on the disk; this step writes about ${s.disk} GiB and wants ${s.spare || 1} GiB left over.`);
  if (dry) { for (const n of s.needs || []) if (!fs.existsSync(path.join(ROOT, n))) console.log(`      (reads ${n}: not there yet, an earlier step writes it)`); continue; }
  for (const n of s.needs || []) if (!fs.existsSync(path.join(ROOT, n))) { console.error(`  !! ${n} is missing: an earlier step should have written it. Run without --from.`); process.exit(1); }
  if (problems && !force) { console.error('\nStopped before this step (see !! above). Free what is needed and run again with --from ' + (i + 1) + ', or add --force to try anyway.'); process.exit(1); }
  problems = 0;
  for (const r of runs) {
    const t = Date.now();
    const logged = s.verify && !quick;
    const res = s.py ? spawnSync(path.join(ROOT, PYTHON), r, { cwd: ROOT, stdio: 'inherit' })
      : spawnSync(process.execPath, logged ? ['-e', TEE, path.join(ROOT, VERIFY_LOG[model]), ...r] : r, { cwd: ROOT, stdio: 'inherit' });
    if (res.status !== 0) { console.error(`\nStep ${i + 1} failed (node ${r.join(' ')} ended with ${res.status === null ? res.signal : 'code ' + res.status}). Nothing after it was run. When the cause is fixed: node tools/build.js ${model} --from ${i + 1}`); process.exit(1); }
    console.log(`      done in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
}
if (dry) {
  console.log(problems ? `\nDry run: ${problems} thing(s) to fix first (see !! above).` : '\nDry run: the model files are there and there is enough memory and disk for every step as things are now.');
  process.exit(problems ? 1 : 0);
}
const ask = model === 'small' ? 'node compiler/smollm/pure/ask.js "What is the capital of France?"' : model === '0.8b' ? 'node compiler/qwen3.5/program/ask.js "What is the capital of France?"'
  : model === '0.8b-vision' ? 'node compiler/qwen3.5/vision/ask.js compiler/qwen3.5/vision/pictures/cat.png "Describe this picture in one sentence."'
  : model === 'coder-0.5b' ? 'node compiler/qwen/program/ask.js --model coder-0.5b "Print the input backwards."' : `node compiler/qwen/program/ask.js --model ${model} "What is the capital of France?"`;
const chunks = `node tools/make-chunks.js ${model}${['small', '0.5b', 'coder-0.5b'].includes(model) ? '' : ' --chunk 16777216'}`;
console.log(`\nBuilt${noVerify ? '' : ' and verified'}. Ask it a question:\n  ${ask}\nor start the site (python tools/serve.py) and open the chat page. For a web host: ${chunks}`);
