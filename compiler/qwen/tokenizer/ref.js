'use strict';

// Plain JavaScript reference for the tokenizer of the Qwen2.5 chat models.

const fs = require('fs');
const path = require('path');

// Unicode White_Space, and the same without CR and LF.
const WS = '\\t-\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const EXPECTED_RE = "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+";
const WORD_RE = new RegExp(
  "(?i:'s|'t|'re|'ve|'m|'ll|'d)" +
  '|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+' +
  '|\\p{N}' +
  `| ?[^${WS}\\p{L}\\p{N}]+[\\r\\n]*` +
  `|[${WS}]*[\\r\\n]+` +
  `|[${WS}]+(?![^${WS}])` +
  `|[${WS}]+`, 'gu');

const SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';

// GPT-2's reversible map between a byte and a printable character.
function byteChars() {
  const keep = new Set();
  for (let b = 33; b <= 126; b++) keep.add(b);
  for (let b = 161; b <= 172; b++) keep.add(b);
  for (let b = 174; b <= 255; b++) keep.add(b);
  const byteChar = [];
  let extra = 0;
  for (let b = 0; b < 256; b++) byteChar[b] = String.fromCharCode(keep.has(b) ? b : 256 + extra++);
  return byteChar;
}

// The pre-tokenizer's words of an (already normalized) text.
function splitWords(text) {
  const words = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (m.index > last) words.push(text.slice(last, m.index));   // "Isolated": the gaps are words too (there are none)
    words.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) words.push(text.slice(last));
  return words;
}

function loadTokenizer(dir) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer_config.json'), 'utf8'));
  const need = (ok, msg) => { if (!ok) throw new Error('ref: tokenizer.json is not what this file was written for: ' + msg); };
  need(t.normalizer && t.normalizer.type === 'NFC', 'normalizer');
  const pre = t.pre_tokenizer.pretokenizers;
  need(pre.length === 2 && pre[0].type === 'Split' && pre[0].pattern.Regex === EXPECTED_RE && pre[0].behavior === 'Isolated' && !pre[0].invert, 'split rule');
  need(pre[1].type === 'ByteLevel' && !pre[1].add_prefix_space && !pre[1].use_regex, 'byte level');
  need(t.model.type === 'BPE' && !t.model.continuing_subword_prefix && !t.model.end_of_word_suffix && !t.model.dropout, 'model');
  need(cfg.chat_template.includes(`{{- '<|im_start|>system\\n${SYSTEM}<|im_end|>\\n' }}`), 'default system prompt');
  need(cfg.chat_template.includes(`{{- '<|im_start|>' + message.role + '\\n' + message.content + '<|im_end|>' + '\\n' }}`) &&
    cfg.chat_template.includes(`{{- '<|im_start|>assistant\\n' }}`), 'chat template');

  const vocab = new Map(Object.entries(t.model.vocab));
  const tokens = [];                                    // id -> the token as written in the vocabulary
  for (const [s, id] of vocab) tokens[id] = s;
  const added = t.added_tokens.map((a) => ({ id: a.id, text: a.content, special: a.special }));
  for (const a of t.added_tokens) need(!a.normalized && !a.lstrip && !a.rstrip && !a.single_word, 'added token flags');
  for (const a of added) tokens[a.id] = a.text;
  const addedId = new Map(added.map((a) => [a.text, a.id]));
  const addedById = new Map(added.map((a) => [a.id, a]));
  const rank = new Map();
  t.model.merges.forEach((mg, i) => rank.set(Array.isArray(mg) ? mg.join(' ') : mg, i));

  const byteChar = byteChars(), charByte = new Map(byteChar.map((c, b) => [c, b]));

  // BPE of one word (given in the vocabulary's byte characters).
  const cache = new Map();
  const bpe = (word) => {
    const hit = cache.get(word);
    if (hit) return hit;
    let parts = Array.from(word);
    for (;;) {
      let best = Infinity, at = -1;
      for (let i = 0; i + 1 < parts.length; i++) {
        const r = rank.get(parts[i] + ' ' + parts[i + 1]);
        if (r !== undefined && r < best) { best = r; at = i; }
      }
      if (at < 0) break;
      const a = parts[at], b = parts[at + 1], next = [];
      for (let i = 0; i < parts.length; i++) {            // every occurrence of the best pair, left to right
        if (i + 1 < parts.length && parts[i] === a && parts[i + 1] === b) { next.push(a + b); i++; } else next.push(parts[i]);
      }
      parts = next;
    }
    const ids = parts.map((s) => vocab.get(s));
    if (cache.size < 200000) cache.set(word, ids);
    return ids;
  };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const addedRe = new RegExp('(' + added.map((a) => a.text).sort((x, y) => y.length - x.length).map(esc).join('|') + ')');

  // Words of a text that holds no added token: [[bytes of word 1], ...]
  const wordsOf = (piece) => splitWords(piece.normalize('NFC')).map((w) => Array.from(Buffer.from(w, 'utf8')));

  // Without step 1: the text is taken as ordinary text even if it is an added token.
  const encodePlain = (text) => wordsOf(text).flatMap((bytes) => bpe(bytes.map((b) => byteChar[b]).join('')));

  const encode = (text) => {
    const ids = [];
    for (const piece of text.split(addedRe)) {
      if (!piece) continue;
      if (addedId.has(piece)) { ids.push(addedId.get(piece)); continue; }
      for (const bytes of wordsOf(piece)) ids.push(...bpe(bytes.map((b) => byteChar[b]).join('')));
    }
    return ids;
  };

  // The bytes one token prints (special tokens: none).
  const tokenBytes = (id) => {
    const a = addedById.get(id);
    if (a) return a.special ? [] : Array.from(Buffer.from(a.text, 'utf8'));
    if (tokens[id] === undefined) return [];              // rows of the embedding table that are no token
    return Array.from(tokens[id], (c) => charByte.get(c));
  };

  const chatPrefix = `<|im_start|>system\n${SYSTEM}<|im_end|>\n<|im_start|>user\n`;
  const chatSuffix = '<|im_end|>\n<|im_start|>assistant\n';
  const chatPrompt = (question) => chatPrefix + question + chatSuffix;

  return { added, encode, encodePlain, tokenBytes, chatPrompt, chatPrefix, chatSuffix };
}

module.exports = { WS, loadTokenizer, byteChars };
