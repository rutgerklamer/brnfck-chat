'use strict';
// A program file as many small compressed files in site/dist/<name>/, for a plain static web host.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'site', 'dist');
const LEVEL = 6;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- worker thread: compress one chunk, write it
if (!isMainThread) {
  parentPort.on('message', ({ index, file, raw }) => {
    const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const gz = zlib.gzipSync(buf, { level: LEVEL });
    fs.writeFileSync(file, gz);
    parentPort.postMessage({ index, bytes: gz.length, sha256: sha(gz), rawSha256: sha(buf) });
  });
  return;
}

// ---- main thread
const PROGRAMS = {
  small: { program: 'site/programs/brnfck-smollm2-135m.bf', meta: 'site/programs/brnfck-smollm2-135m.meta.json' },
  '0.5b': { program: 'site/programs/brnfck-qwen2.5-0.5b.bf', meta: 'site/programs/brnfck-qwen2.5-0.5b.meta.json' },
  '1.5b': { program: 'site/programs/brnfck-qwen2.5-1.5b.bf', meta: 'site/programs/brnfck-qwen2.5-1.5b.meta.json' },
  '0.8b': { program: 'site/programs/brnfck-qwen3.5-0.8b.bf', meta: 'site/programs/brnfck-qwen3.5-0.8b.meta.json' },
  '0.8b-vision': { program: 'site/programs/brnfck-qwen3.5-0.8b-vision.bf', meta: 'site/programs/brnfck-qwen3.5-0.8b-vision.meta.json' },
};
const USAGE = 'usage: node tools/make-chunks.js small|0.5b|1.5b|0.8b|0.8b-vision [--chunk N]   |   verify <name>   |   join <name> [file]   |   single <name>   |   base <name> <url>';
const num = (n) => Math.round(n).toLocaleString('en-US');
const mb = (n) => (n / 1e6).toFixed(n < 1e8 ? 1 : 0) + ' MB';
const now = () => Number(process.hrtime.bigint()) / 1e9;
const chunkName = (i) => `${String(Math.floor(i / 1000)).padStart(3, '0')}/${String(i).padStart(6, '0')}.gz`;
function freeDisk(dir) { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return null; } }
function die(message) { console.error('make-chunks: ' + message); process.exit(1); }

function readFull(fd, buf, pos) {
  let got = 0;
  while (got < buf.length) { const n = fs.readSync(fd, buf, got, buf.length - got, pos + got); if (!n) break; got += n; }
  return got;
}

// The manifest as JSON, with one line per chunk.
function writeManifest(file, manifest) {
  fs.writeFileSync(file, JSON.stringify(manifest, null, 1).replace(/\{\n\s+"file": ("[^"]+"),\n\s+"bytes": (\d+),\n\s+"sha256": ("[^"]+"),\n\s+"rawSha256": ("[^"]+")\n\s+\}/g, '{ "file": $1, "bytes": $2, "sha256": $3, "rawSha256": $4 }') + '\n');
}

// gzip files one after the other are one gzip file: no compressing again.
function single(name) {
  const dir = path.join(DIST, name), mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) die(`${mf} is missing: run  node tools/make-chunks.js ${name}  first`);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8')), file = m.program + '.gz', to = path.join(dir, file);
  const free = freeDisk(dir);
  if (free !== null && free < m.compressedBytes + 2e9) die(`not enough room on the disk for ${to} (${mb(m.compressedBytes)} plus 2 GB must be free)`);
  const t0 = now(), out = fs.openSync(to + '.part', 'w'), sum = crypto.createHash('sha256');
  let bytes = 0;
  for (const c of m.chunks) {
    const gz = fs.readFileSync(path.join(dir, c.file));
    if (gz.length !== c.bytes || sha(gz) !== c.sha256) { fs.closeSync(out); fs.rmSync(to + '.part', { force: true }); die(`${c.file} is not the file the manifest describes: nothing written`); }
    fs.writeSync(out, gz); sum.update(gz); bytes += gz.length;
  }
  fs.closeSync(out);
  fs.renameSync(to + '.part', to);
  const next = {};
  for (const k of Object.keys(m)) { if (k === 'single') continue; if (k === 'chunks') next.single = { file, bytes, sha256: sum.digest('hex') }; next[k] = m[k]; }
  writeManifest(mf, next);
  console.log(`${to}: ${num(bytes)} bytes, SHA-256 ${next.single.sha256}  [${(now() - t0).toFixed(0)} s]\n(gunzip gives ${m.program}, ${num(m.totalBytes)} characters, SHA-256 ${m.sha256}; noted in the manifest as "single")`);
}

async function make(name, chunk) {
  const P = PROGRAMS[name];
  if (!P) die(`unknown program "${name}": use small, 0.5b, 1.5b or 0.8b`);
  const file = path.resolve(ROOT, P.program), metaFile = path.resolve(ROOT, P.meta);
  if (!fs.existsSync(file)) die(`${file} is missing: build it first with  node tools/build.js ${name}`);
  if (!fs.existsSync(metaFile)) die(`${metaFile} is missing: it is written by the same build as the program`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const total = fs.statSync(file).size;
  if (total !== meta.programBytes) die(`${file} is ${num(total)} bytes, its meta file says ${num(meta.programBytes)}: build again`);
  if (chunk % 65536 || chunk <= 0) die('--chunk must be a multiple of 65,536');
  const jobs = Math.max(1, Math.min(12, os.cpus().length - 2));
  const count = Math.ceil(total / chunk), dir = path.join(DIST, name);
  const free = freeDisk(fs.existsSync(DIST) ? DIST : ROOT), need = total * 0.26 + 64e6;
  console.log(`${file}: ${num(total)} characters -> ${num(count)} chunks of ${num(chunk)}, gzip level ${LEVEL}, ${jobs} threads`);
  console.log(`expected on disk: up to ${mb(need)}; free: ${free === null ? 'unknown' : mb(free)}`);
  if (free !== null && free < need + 2e9) die('not enough room on the disk (the expected size plus 2 GB must be free): nothing written');
  if (fs.existsSync(path.join(dir, 'manifest.json'))) console.log(`(replacing ${dir})`);
  fs.rmSync(dir, { recursive: true, force: true });
  for (let i = 0; i < count; i += 1000) fs.mkdirSync(path.dirname(path.join(dir, chunkName(i))), { recursive: true });

  const t0 = now(), whole = crypto.createHash('sha256'), chunks = new Array(count);
  const fd = fs.openSync(file, 'r');
  let next = 0, done = 0, compressed = 0, told = 0, failed = null;
  await new Promise((resolve) => {
    const workers = [];
    const give = (w) => {
      if (failed || next >= count) { if (done >= count || failed) { for (const x of workers) x.terminate(); resolve(); } return; }
      const index = next++, raw = new Uint8Array(Math.min(chunk, total - index * chunk));
      if (readFull(fd, raw, index * chunk) !== raw.length) { failed = new Error('the file ended early'); return give(w); }
      whole.update(raw);                                   // chunks are read in order, so this is the hash of the whole file
      w.postMessage({ index, file: path.join(dir, chunkName(index)), raw }, [raw.buffer]);
    };
    for (let j = 0; j < Math.min(jobs, count); j++) {
      const w = new Worker(__filename);
      workers.push(w);
      w.on('error', (e) => { failed = e; for (const x of workers) x.terminate(); resolve(); });
      w.on('message', (m) => {
        chunks[m.index] = { file: chunkName(m.index), bytes: m.bytes, sha256: m.sha256, rawSha256: m.rawSha256 };
        done++; compressed += m.bytes;
        if (now() - told > 5) { told = now(); console.log(`      ... ${num(done)} of ${num(count)} chunks, ${mb(compressed)} written  [${(now() - t0).toFixed(0)} s]`); }
        give(w);
      });
      give(w);
    }
  });
  fs.closeSync(fd);
  if (failed) die(String(failed.message || failed));
  const secs = now() - t0;
  console.log(`${num(count)} chunks: ${num(total)} characters -> ${num(compressed)} bytes (${(compressed / total * 100).toFixed(2)}%) in ${secs.toFixed(1)} s (${(total / 2 ** 20 / secs).toFixed(0)} MiB of text per second)`);
  const sum = whole.digest('hex');
  if (sum !== meta.sha256) die(`the SHA-256 of ${file} is ${sum}, its meta file says ${meta.sha256}: the file is not the one that was built. No manifest written.`);
  const manifest = {
    format: 'bf-chunks-1', name, program: path.basename(file), compression: 'gzip', level: LEVEL, chunkBytes: chunk,
    totalBytes: total, writerBytes: meta.writerBytes, sha256: sum, compressedBytes: compressed, base: '', meta: 'meta.json', chunks,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), fs.readFileSync(metaFile));
  // the program holds the model's weights: its licence goes along with every copy (NOTICE)
  fs.copyFileSync(path.join(ROOT, 'NOTICE'), path.join(dir, 'NOTICE.txt'));
  fs.copyFileSync(path.join(ROOT, 'LICENSES', 'Apache-2.0.txt'), path.join(dir, 'LICENSE-Apache-2.0.txt'));
  writeManifest(path.join(dir, 'manifest.json'), manifest);
  const largest = chunks.reduce((a, c) => Math.max(a, c.bytes), 0);
  console.log(`${path.join(dir, 'manifest.json')} written: SHA-256 of the whole program ${sum} (equal to the build's)`);
  console.log(`largest chunk file ${mb(largest)}; the folder holds ${mb(compressed)} in ${num(count)} chunks`);
}

// Reads dist/<name>/ back. With `to`: also writes the program text there.
function readBack(name, to) {
  const dir = path.join(DIST, name), mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) die(`${mf} is missing: run  node tools/make-chunks.js ${name}  first`);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (m.format !== 'bf-chunks-1') die(`${mf}: unknown format ${m.format}`);
  if (m.base) console.log(`(the manifest says the chunks are served from ${m.base}; this command reads the local files in ${dir})`);
  const t0 = now(), whole = crypto.createHash('sha256');
  let out = null, at = 0, bad = 0;
  if (to) {
    const free = freeDisk(path.dirname(to));
    if (free !== null && free < m.totalBytes + 2e9) die(`not enough room on the disk for ${to} (${mb(m.totalBytes)} plus 2 GB must be free)`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    out = fs.openSync(to + '.part', 'w');
  }
  m.chunks.forEach((c, i) => {
    const f = path.join(dir, c.file);
    if (!fs.existsSync(f)) die(`${f} is missing`);
    const gz = fs.readFileSync(f), want = Math.min(m.chunkBytes, m.totalBytes - i * m.chunkBytes);
    if (gz.length !== c.bytes || sha(gz) !== c.sha256) { bad++; console.log(`FAIL  ${c.file}: not the file the manifest describes`); return; }
    const raw = zlib.gunzipSync(gz);
    if (raw.length !== want || sha(raw) !== c.rawSha256) { bad++; console.log(`FAIL  ${c.file}: its text is not what the manifest describes`); return; }
    whole.update(raw); at += raw.length;
    if (out) fs.writeSync(out, raw);
  });
  if (out) fs.closeSync(out);
  const sum = whole.digest('hex'), ok = !bad && at === m.totalBytes && sum === m.sha256;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${num(m.chunks.length)} chunks, ${num(at)} of ${num(m.totalBytes)} characters, SHA-256 of the whole ${sum}${ok ? ' = the manifest\'s' : ' (the manifest says ' + m.sha256 + ')'}  [${(now() - t0).toFixed(0)} s]`);
  if (to) {
    if (!ok) { fs.rmSync(to + '.part', { force: true }); die('nothing written'); }
    fs.renameSync(to + '.part', to);
    const metaTo = path.join(path.dirname(to), path.basename(to).replace(/\.bf$/, '') + '.meta.json');
    if (!fs.existsSync(metaTo) && fs.existsSync(path.join(dir, 'meta.json'))) fs.copyFileSync(path.join(dir, 'meta.json'), metaTo);
    console.log(`${to} written (${num(at)} characters)`);
  }
  if (!ok) process.exit(1);
}

function setBase(name, url) {
  const mf = path.join(DIST, name, 'manifest.json');
  if (!fs.existsSync(mf)) die(`${mf} is missing`);
  if (url && !/\/$/.test(url)) die('the URL must be that of a folder and end in /');
  const text = fs.readFileSync(mf, 'utf8'), next = text.replace(/"base": "[^"]*"/, `"base": ${JSON.stringify(url)}`);
  if (next === text && JSON.parse(text).base !== url) die('could not find "base" in the manifest');
  fs.writeFileSync(mf, next);
  console.log(`${mf}: the chunks are now expected ${url ? 'in ' + url : 'next to the manifest'}`);
}

(async () => {
  const argv = process.argv.slice(2), i = argv.indexOf('--chunk');
  const chunk = i < 0 ? 4194304 : Number(argv.splice(i, 2)[1]);
  const [a, b, c] = argv;
  if (!a) die(USAGE);
  if (a === 'verify') readBack(b, null);
  else if (a === 'join') readBack(b, path.resolve(c || path.join(ROOT, (PROGRAMS[b] || die(`unknown program "${b}"`)).program)));
  else if (a === 'base') setBase(b, c || '');
  else if (a === 'single') single(b);
  else await make(a, chunk);
})();
