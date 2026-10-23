'use strict';

// The data of the brainfuck tokenizer (gen.js) for the Qwen2.5 chat models.

const fs = require('fs');
const path = require('path');
const { DEFAULTS, CLASS, ID_BITS, S_BYTE, S_PAIR, C2_FAKE, C2_VALID } = require('./gen');
const { WS, loadTokenizer, byteChars } = require('./ref');

// ---- character classes -----------------------------------------------------------

const WS_RE = new RegExp(`[${WS}]`), L_RE = /\p{L}/u, N_RE = /\p{N}/u;
// The class of a character, as the word splitting rule sees it.
function charClass(cp) {
  if (cp >= 0xd800 && cp <= 0xdfff) return CLASS.O;
  const ch = String.fromCodePoint(cp);
  if (cp < 128) {
    if (ch === ' ') return CLASS.SP;
    if (ch === '\n' || ch === '\r') return CLASS.NL;
    if (ch === "'") return CLASS.APOS;
    const low = ch.toLowerCase();
    if ('stmd'.includes(low)) return CLASS.L1;       // 's 't 'm 'd
    if ('rv'.includes(low)) return CLASS.LRV;        // 're 've
    if (low === 'e') return CLASS.LE;
    if (low === 'l') return CLASS.LL;                // 'll
  }
  if (L_RE.test(ch)) return CLASS.L;
  if (N_RE.test(ch)) return CLASS.D;
  if (WS_RE.test(ch)) return CLASS.WS;
  return CLASS.O;
}

// Entry b: the class of a first byte b, and in sub the 64-entry table for the next byte when that decides the class.
function byteTable() {
  const entry = [{ cls: 0, sub: 0 }], tables = [];
  const most = (list) => {
    const n = new Map();
    for (const c of list) n.set(c, (n.get(c) || 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1])[0][0];
  };
  const same = (list) => list.every((c) => c === list[0]);
  const under = (prefix, more) => {
    const out = [], n = 1 << (6 * more);
    for (let i = 0; i < n; i++) { const cp = prefix * n + i; out.push(cp > 0x10ffff ? CLASS.O : charClass(cp)); }
    return out;
  };
  // An entry for the characters under `prefix`; `depth` more bytes may be looked at.
  const make = (prefix, more, depth) => {
    const all = under(prefix, more), e = { cls: most(all), sub: 0 };
    if (depth > 0 && !same(all)) {
      const t = { rows: null };
      tables.push(t); e.sub = tables.length;                      // numbered in the order they are met
      t.rows = Array.from({ length: 64 }, (_, b) => make(prefix * 64 + b, more - 1, depth - 1));
    }
    return e;
  };
  const lead = [];
  for (let b = 1; b < 256; b++) {
    if (b < 0x80) lead[b] = { cls: charClass(b), sub: 0 };
    else if (b < 0xc0) lead[b] = { cls: CLASS.CB, sub: 0 };
    else lead[b] = { cls: CLASS.O, sub: 0 };                      // C0, C1, F5..FF never occur in UTF-8
  }
  // Tables are numbered in this order; the ones for common characters first (shorter walks).
  const order = [0xc3, 0xc2];
  for (let b = 0xc4; b <= 0xdf; b++) order.push(b);
  order.push(0xe2, 0xe3, 0xef, 0xe0, 0xe1);
  for (let b = 0xe4; b <= 0xee; b++) order.push(b);
  order.push(0xf0, 0xf1, 0xf2, 0xf3, 0xf4);
  for (const b of order) {
    if (b < 0xe0) lead[b] = make(b & 31, 1, 1);
    else if (b < 0xf0) lead[b] = make(b & 15, 2, 2);
    else lead[b] = make(b & 7, 3, 1);
  }
  for (let b = 1; b < 256; b++) entry[b] = lead[b];
  for (const t of tables) for (const r of t.rows) entry.push(r);
  return { entry, tables: tables.length };
}

// ---- everything -------------------------------------------------------------------

function packTokenizer(opts, dir) {
  const o = { ...DEFAULTS, ...opts };
  const { hiBits, midBits, loBits, maxPre, maxSuf, mult, subTables, stackCap } = o;
  const U = 1 << loBits, slots = 1 << ID_BITS, blocks = (1 << (hiBits + midBits)) + 1, records = blocks * U;
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
  const tok = loadTokenizer(dir);                          // (also checks that tokenizer.json has the expected rules)
  const vocab = t.model.vocab, nTok = Object.keys(vocab).length;
  const need = (ok, msg) => { if (!ok) throw new Error('pack: ' + msg); };
  need(hiBits + midBits + loBits === ID_BITS, 'hiBits + midBits + loBits must be 18');
  const lastId = Math.max(nTok - 1, ...t.added_tokens.map((a) => a.id));
  need(lastId + 1 < slots - 4096, 'token ids must fit 18 bits with room to spare');

  // ---- bytes: token and class --------------------------------------------------
  const byteChar = byteChars();
  const byteId = byteChar.map((ch) => vocab[ch]);
  need(byteId.every((id) => id !== undefined && id < 256) && new Set(byteId).size === 256, 'the 256 bytes are not the tokens 0..255');
  const idByte = []; byteId.forEach((id, b) => { idByte[id] = b; });
  const bt = byteTable();
  need(bt.tables <= subTables, `${bt.tables} class tables do not fit subTables = ${subTables}`);
  need(bt.tables < 256 && bt.entry.every((en, i) => i === 0 || en.cls > 0), 'byte table');

  // ---- merges ----------------------------------------------------------------
  const pairs = t.model.merges.map((mg, r) => {
    const [a, b] = Array.isArray(mg) ? mg : mg.split(' ');
    const q = { a: vocab[a], b: vocab[b], v: vocab[a + b] };
    need(q.a !== undefined && q.b !== undefined && q.v !== undefined, `merge ${r} uses an unknown token`);
    need(q.v === 256 + r, `merge ${r} does not make token ${256 + r}: rank order is not id order`);
    need(q.a < q.v && q.b < q.v, `merge ${r}: a part is newer than the result`);
    return q;
  });
  need(pairs.length + 256 === nTok, 'tokens that are neither a byte nor a merge');

  // ---- the table ------------------------------------------------------------------
  const C1 = new Uint32Array(records), C2 = new Uint32Array(records), SS = new Uint32Array(records);
  const slotOf = new Int32Array(slots).fill(-1);            // token id -> its slot
  const put = (q, h, fake) => {
    C1[h] = (q.a + 1) + (q.v % (1 << 14)) * (1 << 18);
    C2[h] = (q.b + 1) + (fake ? C2_FAKE : 0) + (q.v >> 14) * (1 << 19) + C2_VALID;
  };
  for (const q of pairs) {
    let h = ((q.a + 1) * mult[0] + (q.b + 1) * mult[1]) % slots;
    while (C2[h]) h++;
    need(h < slots, 'the hash table runs into its spare block');
    put(q, h, false);
    slotOf[q.v] = h;
  }
  // how to print: bytes and pairs
  for (let id = 0; id < 256; id++) SS[id] = S_BYTE + idByte[id];
  for (const q of pairs) SS[q.v] = S_PAIR + slotOf[q.v];
  let spareId = slots - 2, scan = 0;                      // (id + 1 must fit 18 bits)
  const freeSlot = () => {
    for (scan++; scan < slots - 1; scan++) if (!C2[scan - 1] && !C2[scan] && !C2[scan + 1]) return scan;
    throw new Error('pack: no free slot');
  };
  const depth = new Uint8Array(slots);                     // the stack PRINT needs: printing (a, b) puts b aside while a is printed
  let deepest = 0;
  for (const q of pairs) { depth[q.v] = Math.max(1 + depth[q.a], depth[q.b]); deepest = Math.max(deepest, depth[q.v]); }
  for (const a of tok.added) {
    if (a.special) continue;
    const parts = tok.encodePlain(a.text), k = parts.length;
    need(k >= 1 && Buffer.from(parts.flatMap((id) => tok.tokenBytes(id))).toString('utf8') === a.text, `cannot spell ${a.text}`);
    if (k === 1) { SS[a.id] = SS[parts[0]]; continue; }
    // node i = (parts[i], node i + 1); the last node is (parts[k - 2], parts[k - 1])
    const node = [a.id];
    for (let i = 1; i < k - 1; i++) node.push(spareId--);
    for (let i = k - 2; i >= 0; i--) {
      const rest = i === k - 2 ? parts[k - 1] : node[i + 1], h = freeSlot();
      put({ a: parts[i], b: rest, v: 0 }, h, true);
      SS[node[i]] = S_PAIR + h;
      depth[node[i]] = Math.max(1 + depth[parts[i]], depth[rest]); deepest = Math.max(deepest, depth[node[i]]);
    }
  }
  need(spareId > lastId + 1024, 'spare ids');
  for (let h = slots; h < records; h++) need(!C2[h], 'spare block in use');
  need(deepest <= stackCap, `PRINT needs a stack of ${deepest}`);

  // ---- chat template ----------------------------------------------------------
  need(tok.chatPrefix.endsWith('user\n'), 'chat template has an unexpected shape');
  const prefix = tok.encode(tok.chatPrefix.slice(0, -1)), suffix = tok.encode(tok.chatSuffix);   // the "\n" before the question is the program's job
  need(prefix.length <= maxPre && suffix.length <= maxSuf, 'template does not fit maxPre / maxSuf');
  for (const q of ['', 'Hi', ' x', '\n\ny', '5', '!']) {
    need(tok.encode(tok.chatPrompt(q)).join() === [...prefix, ...tok.encode('\n' + q), ...suffix].join(), 'the prompt is not prefix + "\\n" question + suffix');
  }

  // ---- the stream -------------------------------------------------------------------
  const byteRecs = 256 + 64 * subTables;
  const out = new Uint8Array(3 * maxPre + 3 * maxSuf + 4 * (byteRecs - 1) + blocks * (1 + 10 * U));
  let n = 0;
  const num = (v, k) => { for (let i = k - 1; i >= 0; i--) out[n++] = Math.floor(v / 2 ** (8 * i)) % 256; };
  for (let i = 0; i < maxPre; i++) num(i < prefix.length ? prefix[i] + 1 : 0, 3);
  for (let i = 0; i < maxSuf; i++) num(i < suffix.length ? suffix[i] + 1 : 0, 3);
  for (let i = 1; i < byteRecs; i++) {
    const en = bt.entry[i] || { cls: 0, sub: 0 };
    num(i < 256 ? byteId[i] + 1 : 0, 2); num(en.cls, 1); num(en.sub, 1);
  }
  // LANE = 1 in the header a long hop lands on: block j * 2^midBits - 1, j = 1 .. 2^hiBits - 1
  const lane = (k) => ((k + 1) % (1 << midBits) === 0 && k + 1 < blocks - 1 ? 1 : 0);
  for (let k = 0; k < blocks; k++) {
    num(lane(k), 1);
    for (let i = k * U; i < (k + 1) * U; i++) { num(C1[i], 4); num(C2[i], 3); num(SS[i], 3); }
  }
  need(n === out.length, 'stream length');

  return { bytes: out, info: { vocab: lastId + 1, bpeTokens: nTok, prefix, suffix } };
}

module.exports = { packTokenizer };
