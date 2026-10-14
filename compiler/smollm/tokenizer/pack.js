'use strict';

// The byte stream that the brainfuck tokenizer (gen.js) reads before the question.

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const { DEFAULTS, CLASS } = require('./gen');

function byteClass(b) {
  const ch = String.fromCharCode(b);
  if (b >= 0xc0) return b === 0xc2 || b === 0xe2 || b === 0xf0 ? CLASS.O : CLASS.L;
  if (b >= 0x80) return CLASS.CB;
  if (ch >= '0' && ch <= '9') return CLASS.D;
  if (ch === ' ') return CLASS.SP;
  if (b >= 9 && b <= 13) return CLASS.WS;
  if (ch === "'") return CLASS.APOS;
  if ('stmd'.includes(ch)) return CLASS.L1;      // 's 't 'm 'd
  if ('rv'.includes(ch)) return CLASS.LRV;       // 're 've
  if (ch === 'e') return CLASS.LE;
  if (ch === 'l') return CLASS.LL;               // 'll
  if (/[A-Za-z]/.test(ch)) return CLASS.L;
  return CLASS.O;
}

function packTokenizer(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { W, topBits, hashBits, maxPre, maxSuf, mult } = o;
  const U = 1 << topBits, slots = 1 << hashBits, records = slots + U;
  const t = JSON.parse(fs.readFileSync(path.join(F.DIR, 'tokenizer.json'), 'utf8'));
  const vocab = t.model.vocab, nTok = Object.keys(vocab).length;
  const need = (ok, msg) => { if (!ok) throw new Error('pack: ' + msg); };
  need(nTok <= 65535 && hashBits === 16, 'token ids must fit 16 bits');

  // ---- text of every token, as bytes --------------------------------------
  const byteChar = F.byteChars(), charByte = new Map(byteChar.map((c, b) => [c, b]));
  const text = [];
  for (const [s, id] of Object.entries(vocab)) text[id] = Array.from(s, (c) => charByte.get(c));
  for (const a of t.added_tokens) { need(a.special, 'added token that is not special'); text[a.id] = []; }   // print nothing
  for (let id = 0; id < nTok; id++) need(text[id] && text[id].every((b) => b !== undefined && b < 255), `token ${id}: text is not bytes below 255`);

  // ---- merges ----------------------------------------------------------------
  const pairs = t.model.merges.map((mg, r) => {
    const [a, b] = Array.isArray(mg) ? mg : mg.split(' ');
    const p = { a: vocab[a], b: vocab[b], v: vocab[a + b] };
    need(p.a > 0 && p.b > 0 && p.v !== undefined, `merge ${r} uses an unknown token`);
    need(p.a < p.v && p.b < p.v, `merge ${r}: a part is newer than the result`);
    return p;
  });
  for (let r = 1; r < pairs.length; r++) need(pairs[r].v > pairs[r - 1].v, 'merge rank order is not token id order');

  // ---- chat template ----------------------------------------------------------
  const tok = F.loadTokenizer();
  const MARK = '\u0001';
  const [left, right] = tok.chatPrompt(MARK).split(MARK);
  need(/\p{L}\n$/u.test(left) && right.startsWith('<|im_end|>'), 'chat template has an unexpected shape');
  const prefix = tok.encode(left.slice(0, -1)), suffix = tok.encode(right);   // the "\n" before the question is the program's job
  need(prefix.length <= maxPre && suffix.length <= maxSuf, 'template does not fit maxPre / maxSuf');
  need([...prefix, ...suffix].every((id) => id > 0), 'template uses token 0');

  // ---- per byte: token and class ----------------------------------------------
  const byteId = [], byteCls = [];
  for (let b = 1; b < 256; b++) {
    const id = vocab[byteChar[b]];
    byteId[b] = id === undefined ? 0 : id;
    byteCls[b] = id === undefined ? 0 : byteClass(b);
  }

  // ---- table --------------------------------------------------------------------
  const rec = Array.from({ length: records }, () => ({ a: 0, b: 0, v: 0, s: [], link: 0 }));
  // text half
  let spare = nTok;
  for (let id = 0; id < nTok; id++) {
    let at = id;
    for (let from = 0; ; from += W) {
      rec[at].s = text[id].slice(from, from + W);
      if (from + W >= text[id].length) break;
      need(spare < slots - 1, 'no room for long token texts');
      rec[at].link = spare + 1; at = spare++;
    }
  }
  // merge half
  for (const p of pairs) {
    let h = (p.a * mult[0] * mult[1] + p.b * mult[2]) % slots;
    while (rec[h].v) { h++; need(h < records - 1, 'hash table runs off its end'); }
    Object.assign(rec[h], p);
  }

  // ---- write ----------------------------------------------------------------------
  const out = new Uint8Array(2 * maxPre + 2 * maxSuf + 3 * 255 + records * (8 + W));
  let n = 0;
  const two = (v) => { out[n++] = v >> 8; out[n++] = v & 255; };
  for (let i = 0; i < maxPre; i++) two(prefix[i] || 0);
  for (let i = 0; i < maxSuf; i++) two(suffix[i] || 0);
  for (let b = 1; b < 256; b++) { two(byteId[b]); out[n++] = byteCls[b]; }
  for (const r of rec) {
    two(r.a); two(r.b); two(r.v);
    for (let i = 0; i < W; i++) out[n++] = i < r.s.length ? r.s[i] + 1 : 0;
    two(r.link);
  }
  need(n === out.length, 'stream length');

  return { bytes: out, info: { prefix, suffix } };
}

module.exports = { packTokenizer };
