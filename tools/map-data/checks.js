'use strict';
// The log of a program's verification, as checks.json. It runs nothing.
const fs = require('fs');
const path = require('path');
const { modelOf } = require('./models');
const MODEL = modelOf(process.argv[2]), meta = MODEL.meta;
const log = fs.readFileSync(MODEL.logFile, 'utf8').split(/\r?\n/);
const toNumber = (s) => Number(String(s).replace(/,/g, ''));

const checks = [], questions = [];
let q = null, tapeRun = null, loadRun = null;
for (const line of log) {
  let m;
  if ((m = /^(ok|FAIL)\s+(\d)\s+(.*)$/.exec(line))) {
    const c = { ok: m[1] === 'ok', group: Number(m[2]), text: m[3].trim().replace(/^.*?[\\/][\w.-]+\.bf:\s*/, '') };
    if (q && c.group === 3 && !/both endings/.test(c.text)) q.checks.push(c); else checks.push(c);
  } else if ((m = /^> \[(\d+)\] (".*")\s+\(the spec generates (\d+) ids, ends by (.*)\)$/.exec(line))) {
    q = { index: Number(m[1]), question: JSON.parse(m[2]), ids: Number(m[3]), end: m[4] === 'end token' ? 'end' : 'limit', checks: [] }; questions.push(q);
  } else if ((m = /^> \[(\d+)\] (".*")\s+\(the spec: (\d+) new ids, (.*)\)$/.exec(line))) {
    q = { index: Number(m[1]), question: JSON.parse(m[2]), ids: Number(m[3]), end: /end of turn/.test(m[4]) ? 'end' : 'cut', checks: [] }; questions.push(q);
  } else if (q && (m = /start-up ([\d.]+) s .*first piece after ([\d.]+) s; ([\d.]+) s per (?:word )?piece \(median.*?\); whole run ([\d.]+) s/.exec(line))) {
    Object.assign(q, { startup: Number(m[1]), firstPiece: Number(m[2]), perPiece: Number(m[3]), whole: Number(m[4]) });
  } else if ((m = /writing part run in ([\d.]+) s without any input(?: \((\d+)-bit memory\))?(?:: ([\d,]+) loops \(([\d,]+) different texts\))?/.exec(line))) {
    // (the log of brnfck-qwen3.5-0.8b does not count the loops)
    tapeRun = { seconds: Number(m[1]), memoryBits: m[2] ? Number(m[2]) : 32, loops: m[3] ? toNumber(m[3]) : null, loopTexts: m[4] ? toNumber(m[4]) : null };
  } else if ((m = /load part of (the text program|[\w.-]+) run on the data files in a second process: (\d+) sums/.exec(line))) loadRun = { program: m[1], sums: Number(m[2]) };
  if (q) {
    const b = /input = the (\d+) bytes of the question.*?; the printed text equals the spec's \((\d+) bytes/.exec(line); if (b) { q.inputBytes = Number(b[1]); q.outputBytes = Number(b[2]); }
    const w = /(\d+) word pieces arrived/.exec(line); if (w) q.pieces = Number(w[1]);
    const r = /with ([\d,]+) cells put back/.exec(line); if (r) q.putBack = toNumber(r[1]);
  }
}
// The log of brnfck-qwen3.5-0.8b does not count the word pieces as they arrive; it checks that the printed text is the
// text of the spec's ids, so a question whose checks all passed printed exactly that many word pieces.
for (const x of questions) if (x.pieces === undefined && x.checks.length && x.checks.every((c) => c.ok) && x.outputBytes !== undefined) x.pieces = x.ids;
const summary = log.find((l) => /^all \d+ ok/.test(l));
const avg = (f) => { const v = questions.map(f).filter((x) => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const peak = log.find((l) => /^peak memory/.test(l));
const isEnglish = (t) => !/[^ -~\t]/.test(t) && !/^(Wat|Hoeveel|Leg|Waar) /.test(t);
const putBack = questions.find((x) => x.putBack);

const out = {
  made: 'tools/map-data/checks.js', model: MODEL.id, from: [MODEL.log, MODEL.web.replace(/\.bf$/, '.meta.json')], command: MODEL.logOf,
  summary: summary || null, checks, tapeRun, loadRun, peakMemory: peak || null,
  questions: questions.map((x) => {
    const english = isEnglish(x.question);
    return { ...x, question: english ? x.question : null, note: english ? undefined : 'a question in Dutch, ' + x.inputBytes + ' letters', ok: x.checks.every((c) => c.ok), checks: x.checks.length };
  }),
  timing: { startup: avg((x) => x.startup), firstPiece: avg((x) => x.firstPiece), perPiece: avg((x) => x.perPiece), perPieceMin: Math.min(...questions.map((x) => x.perPiece)), perPieceMax: Math.max(...questions.map((x) => x.perPiece)), runs: questions.length },
  sha256: meta.sha256, pieceCells: meta.pieceCells, tapeCells: meta.tapeSize, tapeSums: meta.tapeSums,
  restore: meta.restore ? { cells: putBack ? putBack.putBack : null } : null,
};
fs.writeFileSync(path.join(MODEL.dir, 'checks.json'), JSON.stringify(out));
console.log(`checks.json: ${checks.length} checks, ${questions.length} questions, ${meta.tapeSums.length} tape sums; ${summary}`);
for (const x of out.questions) console.log(' ', x.index, x.ok, x.checks, x.inputBytes, x.outputBytes, x.pieces, x.perPiece, x.end, JSON.stringify(x.question || x.note));
