'use strict';

// The data of the brainfuck tokenizer (gen.js) for Qwen3.5.

const fs = require('fs');
const path = require('path');
const { DEFAULTS, CLASS, ID_BITS, SLOT_BITS, RC, S_BYTE, S_PAIR, C2_FAKE, C2_VALID } = require('./gen');
const { DIR, WS, loadTokenizer, byteChars } = require('./ref');

// ---- character classes -----------------------------------------------------------

const WS_RE = new RegExp(`[${WS}]`), L_RE = /[\p{L}\p{M}]/u, N_RE = /\p{N}/u;
// The letters of 's 't 'm 'd, 're 've, 'll as (?i:...) sees them (s also matches U+017F).
const FOLD = [[/^[stmd]$/iu, CLASS.L1], [/^[rv]$/iu, CLASS.LRV], [/^e$/iu, CLASS.LE], [/^l$/iu, CLASS.LL]];
// The class of a character, as the word splitting rule sees it. Combining marks are letters.
function charClass(cp) {
  if (cp >= 0xd800 && cp <= 0xdfff) return CLASS.O;
  const ch = String.fromCodePoint(cp);
  if (ch === ' ') return CLASS.SP;
  if (ch === '\n' || ch === '\r') return CLASS.NL;
  if (ch === "'") return CLASS.APOS;
  for (const [re, c] of FOLD) if (re.test(ch)) return c;
  if (L_RE.test(ch)) return CLASS.L;
  if (N_RE.test(ch)) return CLASS.D;
  if (WS_RE.test(ch)) return CLASS.WS;
  return CLASS.O;
}

// Entry b (1..255): the first byte b. Entry 256 + 64 * (t - 1) + (c - 128): byte c in table t.
// A table tells the class by the next byte; every character gets its exact class.
function byteTable() {
  const cls = new Uint8Array(0x110000);
  for (let cp = 0; cp < cls.length; cp++) cls[cp] = charClass(cp);
  const classOf = (cp) => (cp > 0x10ffff ? CLASS.O : cls[cp]);
  // the characters under `prefix` with `more` bytes to come
  const make = (prefix, more) => {
    const n = 1 << (6 * more), count = new Map();
    for (let i = 0; i < n; i++) { const c = classOf(prefix * n + i); count.set(c, (count.get(c) || 0) + 1); }
    const e = { cls: [...count].sort((x, y) => y[1] - x[1])[0][0], sub: 0, rows: null };
    if (count.size > 1) e.rows = Array.from({ length: 64 }, (_, b) => make(prefix * 64 + b, more - 1));
    return e;
  };
  const lead = [];
  for (let b = 1; b < 256; b++) {
    if (b < 0x80) lead[b] = { cls: classOf(b), sub: 0, rows: null };
    else if (b < 0xc0) lead[b] = { cls: CLASS.CB, sub: 0, rows: null };
    else if (b < 0xc2 || b > 0xf4) lead[b] = { cls: CLASS.O, sub: 0, rows: null };     // never in UTF-8
    else lead[b] = make(b < 0xe0 ? b & 31 : b < 0xf0 ? b & 15 : b & 7, b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3);
  }
  // Tables are numbered in this order: the ones for common characters first (shorter walks).
  const tables = [];
  const number = (e, deep = true) => {
    if (!e.rows) return;
    if (!e.sub) { tables.push(e); e.sub = tables.length; }
    if (deep) for (const r of e.rows) number(r);
  };
  number(lead[0xc3]); number(lead[0xc2]);
  for (let b = 0xc4; b <= 0xdf; b++) number(lead[b]);
  number(lead[0xe2]); number(lead[0xe3]); number(lead[0xef]);
  number(lead[0xf0], false); number(lead[0xf0].rows[0x1f]);          // emoji: F0 9F
  number(lead[0xe0]); number(lead[0xe1]);
  for (let b = 0xe4; b <= 0xee; b++) number(lead[b]);
  for (let b = 0xf0; b <= 0xf4; b++) number(lead[b]);
  const entry = [{ cls: 0, sub: 0 }];
  for (let b = 1; b < 256; b++) entry[b] = lead[b];
  for (const t of tables) for (const r of t.rows) entry.push(r);
  return { entry, tables: tables.length, classOf };
}

// ---- everything -------------------------------------------------------------------

function packTokenizer(opts = {}, dir = DIR) {
  const o = { ...DEFAULTS, ...opts };
  const { hiBits, midBits, loBits, maxPre, maxSuf, mult, subTables, stackCap } = o;
  const U = 1 << loBits, slots = 1 << SLOT_BITS, blocks = (1 << (hiBits + midBits)) + 1, records = blocks * U;
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
  const tok = loadTokenizer(dir);                          // (also checks that tokenizer.json has the expected rules)
  const vocab = t.model.vocab, nTok = Object.keys(vocab).length;
  const need = (ok, msg) => { if (!ok) throw new Error('pack: ' + msg); };
  need(hiBits + midBits + loBits === SLOT_BITS, 'hiBits + midBits + loBits must be 19');
  const lastId = tok.lastId, rows = Math.max(lastId + 1, o.rows || 0);
  need(rows + 1024 < 1 << ID_BITS, 'token ids must fit 18 bits with room to spare');

  // ---- bytes: token and class --------------------------------------------------
  const byteChar = byteChars();
  const byteId = byteChar.map((ch) => vocab[ch]);
  need(byteId.every((id) => id !== undefined && id < 256) && new Set(byteId).size === 256, 'the 256 bytes are not the tokens 0..255');
  const idByte = []; byteId.forEach((id, b) => { idByte[id] = b; });
  const bt = byteTable();
  need(bt.tables <= subTables, `${bt.tables} class tables do not fit subTables = ${subTables}`);
  need(bt.tables < 65536 && bt.entry.every((en, i) => i === 0 || en.cls > 0), 'byte table');

  // ---- merges ----------------------------------------------------------------
  // The program merges the pair whose token has the smallest id: that is the pair of the smallest rank
  // because the ids grow with the rank (the tokens no merge makes sit in between).
  const made = new Set();
  const pairs = t.model.merges.map((mg, r) => {
    const [a, b] = Array.isArray(mg) ? mg : mg.split(' ');
    const q = { a: vocab[a], b: vocab[b], v: vocab[a + b] };
    need(q.a !== undefined && q.b !== undefined && q.v !== undefined, `merge ${r} uses an unknown token`);
    need(q.v >= 256 && !made.has(q.v), `merge ${r} makes a byte or a token made before`);
    made.add(q.v);
    return q;
  });
  pairs.forEach((q, r) => need(r === 0 || q.v > pairs[r - 1].v, `merge ${r}: the ids do not grow with the rank`));
  const unmade = [];                                      // tokens of the vocabulary that no merge makes
  for (let id = 256; id < nTok; id++) if (!made.has(id)) unmade.push(id);
  need(pairs.length + 256 + unmade.length === nTok && new Set(Object.values(vocab)).size === nTok && Object.values(vocab).every((id) => id < nTok), 'vocabulary ids');
  for (const q of pairs) need(!unmade.includes(q.a) && !unmade.includes(q.b), 'a merge uses a token that no merge makes');

  // ---- the table ------------------------------------------------------------------
  const C1 = new Uint32Array(records), C2 = new Uint32Array(records), SS = new Uint32Array(records);
  const slotOf = new Int32Array(1 << ID_BITS).fill(-1);    // token id -> its slot
  const hash = (a, b) => ((a + 1) * mult[0] + (b + 1) * mult[1]) % slots;
  const put = (q, h, fake) => {
    C1[h] = (q.a + 1) + (q.v % (1 << 14)) * (1 << 18);
    C2[h] = (q.b + 1) + (fake ? C2_FAKE : 0) + (q.v >> 14) * (1 << 19) + C2_VALID;
  };
  let probeSum = 0, worstProbes = 0;
  for (const q of pairs) {
    let h = hash(q.a, q.b);
    const h0 = h;
    while (C2[h]) h++;
    need(h < slots, 'the hash table runs into its spare block');
    put(q, h, false);
    slotOf[q.v] = h;
    probeSum += h - h0 + 1; worstProbes = Math.max(worstProbes, h - h0 + 1);
  }
  // how to print: bytes and pairs
  const partsOf = new Map();                               // print id -> [a, b]
  for (let id = 0; id < 256; id++) SS[id] = S_BYTE + idByte[id];
  for (const q of pairs) { SS[q.v] = S_PAIR + slotOf[q.v]; partsOf.set(q.v, [q.a, q.b]); }
  let spareId = (1 << ID_BITS) - 2, scan = 0, fakeSlots = 0;  // (id + 1 must fit 18 bits)
  const freeSlot = () => {
    for (scan++; scan < slots - 1; scan++) if (!C2[scan - 1] && !C2[scan] && !C2[scan + 1]) return scan;
    throw new Error('pack: no free slot');
  };
  // A token no merge makes is printed through pairs of its own: node i = (parts[i], node i + 1), the last (parts[k - 2], parts[k - 1]).
  const spell = (id, bytes) => {
    const parts = tok.bpeBytes(bytes), k = parts.length;
    need(k >= 1 && !parts.includes(id) && Buffer.from(parts.flatMap((x) => tok.tokenBytes(x))).equals(Buffer.from(bytes)), `cannot spell token ${id}`);
    if (k === 1) { SS[id] = SS[parts[0]]; partsOf.set(id, partsOf.get(parts[0])); return; }
    const node = [id];
    for (let i = 1; i < k - 1; i++) node.push(spareId--);
    for (let i = k - 2; i >= 0; i--) {
      const rest = i === k - 2 ? parts[k - 1] : node[i + 1], h = freeSlot();
      put({ a: parts[i], b: rest, v: 0 }, h, true);
      fakeSlots++;
      SS[node[i]] = S_PAIR + h;
      partsOf.set(node[i], [parts[i], rest]);
    }
  };
  for (const id of unmade) spell(id, tok.tokenBytes(id));
  for (const a of tok.added) if (!a.special) spell(a.id, tok.tokenBytes(a.id));
  need(spareId > rows, 'spare ids');
  for (let h = slots; h < records; h++) need(!C2[h], 'spare block in use');
  // the stack PRINT needs: printing (a, b) puts b aside while a is printed
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    const ab = partsOf.get(id), d = ab ? Math.max(1 + depthOf(ab[0]), depthOf(ab[1])) : 0;
    depth.set(id, d);
    return d;
  };
  let deepest = 0;
  for (let id = 0; id <= lastId; id++) deepest = Math.max(deepest, depthOf(id));
  need(deepest <= stackCap, `PRINT needs a stack of ${deepest}`);

  // how long a probe for a pair that is not there runs: from every slot to the next empty one
  let missSum = 0;
  for (let h = slots - 1, run = 0; h >= 0; h--) { run = C2[h] ? run + 1 : 0; missSum += run + 1; }

  // ---- chat template ----------------------------------------------------------
  need(tok.chatPrefix.endsWith('user\n'), 'chat template has an unexpected shape');
  // the "\n" before the question is the program's job; o.prefix: other ids before the question (a picture,
  // ../vision/build.js), with o.prompt(q) the text of the whole prompt and no "\n" before the question (lead null)
  const prefix = o.prefix || tok.encode(tok.chatPrefix.slice(0, -1)), suffix = tok.encode(tok.chatSuffix);
  need(prefix.length <= maxPre && suffix.length <= maxSuf, 'template does not fit maxPre / maxSuf');
  need(!o.prefix === (o.lead !== null), 'a prefix of its own goes with no lead byte');
  for (const q of ['', 'Hi', ' x', '\n\ny', '5', '!', ' ', 'á']) {
    if (o.prefix) need(tok.encode(o.prompt(q)).join() === [...prefix, ...tok.encode(q), ...suffix].join(), 'the prompt is not prefix + question + suffix');
    else need(tok.encode(tok.chatPrompt(q)).join() === [...prefix, ...tok.encode('\n' + q), ...suffix].join(), 'the prompt is not prefix + "\\n" question + suffix');
  }

  // ---- the stream -------------------------------------------------------------------
  const byteRecs = 256 + 64 * subTables;
  const out = new Uint8Array(3 * maxPre + 3 * maxSuf + 5 * (byteRecs - 1) + blocks * (1 + 10 * U));
  let n = 0;
  const num = (v, k) => { for (let i = k - 1; i >= 0; i--) out[n++] = Math.floor(v / 2 ** (8 * i)) % 256; };
  for (let i = 0; i < maxPre; i++) num(i < prefix.length ? prefix[i] + 1 : 0, 3);
  for (let i = 0; i < maxSuf; i++) num(i < suffix.length ? suffix[i] + 1 : 0, 3);
  for (let i = 1; i < byteRecs; i++) {
    const en = bt.entry[i] || { cls: 0, sub: 0 };
    num(i < 256 ? byteId[i] + 1 : 0, 2); num(en.cls, 1); num(en.sub, 2);
  }
  // LANE = 1 in the header a long hop lands on: block j * 2^midBits - 1, j = 1 .. 2^hiBits - 1
  const lane = (k) => ((k + 1) % (1 << midBits) === 0 && k + 1 < blocks - 1 ? 1 : 0);
  for (let k = 0; k < blocks; k++) {
    num(lane(k), 1);
    for (let i = k * U; i < (k + 1) * U; i++) { num(C1[i], 4); num(C2[i], 3); num(SS[i], 3); }
  }
  need(n === out.length, 'stream length');
  need(RC === 3, 'records of three cells');

  return {
    bytes: out,
    info: {
      vocab: lastId + 1, bpeTokens: nTok, merges: pairs.length, unmade: unmade.length, prefix, suffix, fixed: o.prefix ? prefix : [...prefix, ...tok.encode('\n')],
      hashLoad: (pairs.length + fakeSlots) / slots, probesPerHit: probeSum / pairs.length, worstProbes, probesPerMiss: missSum / slots,
      classTables: bt.tables, fakeSlots, stackDepth: deepest,
    },
    classOf: bt.classOf,
  };
}

module.exports = { packTokenizer, charClass };
