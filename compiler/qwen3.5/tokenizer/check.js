'use strict';

// Checks the brainfuck tokenizer of Qwen3.5 against ref.js and float.js.
//   node compiler/qwen3.5/tokenizer/check.js          everything (a few minutes)
//   node compiler/qwen3.5/tokenizer/check.js quick    without the lookup of every merge and the timings
//   ... write                                          also writes out/encode.bf, out/print.bf and out/tokenizer.bin

const fs = require('fs');
const path = require('path');
const { Patterns } = require('../../../site/runtime/patterns');
const BFWasm = require('../../../site/runtime/bfwasm');
const { compile } = require('../../core/bf');
const REF = require('./ref');
const G = require('./gen');
const { packTokenizer } = require('./pack');

const quick = process.argv.includes('quick');
const tok = REF.loadTokenizer();
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return `mean ${fmt(s.reduce((x, y) => x + y, 0) / s.length)}, median ${fmt(s[s.length >> 1])}, max ${fmt(s[s.length - 1])}`;
};
let failed = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failed++; process.exitCode = 1; if (failed <= 25) console.log('FAIL', what); } };
const cp = (...codes) => String.fromCodePoint(...codes);
const utf8len = (q) => Buffer.byteLength(q, 'utf8');

let seed = 20261015;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
const pick = (a) => a[rnd(a.length)];

// ---- a small interpreter over the ops of core/bf.js (it counts steps) ------------------

function interp(prog, input, tapeSize) {
  const { T, N, M, X, length } = prog, tape = new Uint32Array(tapeSize), out = [];
  let p = 0, ip = 0, steps = 0;
  for (let i = 0; i < length; i++) {
    steps++;
    p += M[i];
    switch (T[i]) {
      case 0: tape[p] += N[i]; break;
      case 1: out.push(tape[p] & 255); break;
      case 2: tape[p] = ip < input.length ? input[ip++] : 0; break;
      case 3: if (tape[p] === 0) i = N[i] - 1; break;
      case 4: if (tape[p] !== 0) i = N[i] - 1; break;
      case 5: tape[p] = 0; break;
      case 6: case 7: case 8: {
        const v = tape[p];
        if (v) {
          let k = N[i], n = T[i] - 5;
          if (T[i] === 8) n = X[k++];
          for (let j = 0; j < n; j++, k += 2) tape[p + X[k]] += Math.imul(v, X[k + 1]);
          tape[p] = 0;
        }
        break;
      }
      default: break;
    }
  }
  return { output: Buffer.from(out), steps, tape, pointer: p };
}

// ---- questions -------------------------------------------------------------------
const NBSP = cp(0xa0);
const questions = [
  '', 'a', ' ', '  ', '?', 'Hi', 'hi', 'Hello', 'What is pi?', 'What is the capital of France?', 'Name three colors.',
  'Who wrote Romeo and Juliet?', 'How many legs does a spider have?', 'Explain photosynthesis in one sentence.',
  'Is 17 a prime number?', 'What is 12 * 12?', 'Convert 100 degrees Fahrenheit to Celsius.', 'What happened in 1969?',
  'pi = 3.14159265358979', '2+2=4', '1 2 3 4 5 6 7 8 9 10', '007', 'a1b2c3', '3D printing', 'in 2024 and 2025', 'room 12b',
  "don't", "Don't you think it's fine?", "I'm sure they've said we'll go, he'd agree, you're right.", "'really'", "'s", "it's's",
  "the dog's bone", "rock 'n' roll", "'tis the season", "y'all're late", "O'Neil's car", "'ll 'd 'm 're 've 't 's", "x''s", "5's", "a 's",
  "'l", "'r", "'re", "'rx", "'lx", "'ll", "I'LL GO", "we'llbe", "!'s", "\t's ok", "IT'S", "They'Re", "we'VE", "'S", "'T'M'D", "('s)", "a'", "''", "'''re",
  `it'${cp(0x17f)}x`, `'${cp(0x17f)}`, `'${cp(0x301)}s`, `'s${cp(0x334)}`, `'l${cp(0x334)}l`,
  'UPPER CASE WORDS', 'MiXeD cAsE', 'CamelCaseIdentifier and snake_case_name', 'HTTP, URL, JSON and XML', 'e.g. i.e. etc.',
  'Hello, world!', 'Wait... what?!', 'Really??? Yes!!!', '(parentheses) [brackets] {braces} <angles>', '"quoted" and \'single\'',
  'a - b -- c --- d', 'x = y + z * (w - 1) / 2', 'email@example.com', 'https://www.example.com/path?query=1&x=2#frag',
  'C:\\Users\\name\\file.txt', '/usr/local/bin', '50% off, $9.99 only!', '#hashtag @mention', 'a,b;c:d', '~`^|\\',
  ' leading space', '  two leading spaces', 'trailing space ', 'trailing spaces   ', 'double  space', 'triple   space and    four',
  'tab\there', 'tab \t mixed', ' \t ', 'a\t\tb', 'end with tab\t', '\tstart with tab', 'carriage\rreturn', 'space before digit 5', '5 space after digit',
  '\r', ' \r', '\r ', '\r\r x', 'a \r b', 'a.\r\rb', 'a!\r \rb', '!\r', 'x \r', ' (a', '  (a', '\t(a', 'a ( b', 'a (( b', 'a  !!  b', ' ! ', ' 1', '  1', '1  1', '1 !', '1 a',
  'the the the the the', 'buffalo buffalo buffalo buffalo', 'aaaaaaaaaaaaaaaa', 'abababababababab', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'zzzzzz qqqqqq', '!!!!!!!!!!!!', '................', '------------------------', '== != <= >= && ||', '    ', '        indented',
  'antidisestablishmentarianism', 'pneumonoultramicroscopicsilicovolcanoconiosis', 'supercalifragilisticexpialidocious', 'floccinaucinihilipilification',
  'Xylophone zygote quixotic jukebox', 'syzygy', 'Qwertyuiop asdfghjkl zxcvbnm', 'Schadenfreude', 'bf', 'brainfuck', 'Qwen', 'tokenizer',
  'Hoe heet de hoofdstad van Nederland?', 'Wat is het verschil tussen een appel en een peer?', 'Kun je me helpen met mijn huiswerk?',
  'Waarom is de lucht blauw?', "Ik heb zin in 's avonds een kopje thee.", 'Hoe heet de koningin van België?', 'Eén, twee, drie: hoeveel is dat samen?',
  'Wat betekent het woord coördinatie, en hoe zit het met reünie of ideeën?', "Zo'n mooie dag, 's ochtends vroeg.",
  'Schrijf een kort gedicht over de zee, de wind en de duinen.', 'Hoeveel is 3 keer 17, en wat is de wortel van 144?', 'Wat kost een kaartje naar Groningen: € 27,50 of € 31?',
  "Leg in 2 zinnen uit wat 'gezellig' betekent.", 'Welke maand komt na februari? En na december?', 'IJsselmeer, ijs en IJmuiden: waarom twee hoofdletters?',
  "Mijn oma zei altijd: 'wie het kleine niet eert, is het grote niet weerd'.", 'Hoe laat is het in Tokio als het hier 14:30 is?',
  'café naïve résumé', 'Zürich, São Paulo, Kraków', 'Привет, как дела?', '日本語のテキスト', 'Ελληνικά', 'Ünïcödé ßtraße', 'ΑΒΓ αβγ', 'привет — мир',
  '“quoted” — dash', 'price: 5 € or £4', 'naïve café – “ok”…', '中文。标点', '你好，世界！今天是2024年5月1日。', 'こんにちは、世界。カタカナ・ひらがな', '한국어 텍스트입니다.',
  'مرحبا بالعالم', 'שלום עולם', 'नमस्ते दुनिया', 'ภาษาไทย', 'x² + y² = z²', '½ cup, ¾ tsp', `no${NBSP}break`, `10${NBSP}000 km`, '5 × 3 ÷ 2', 'señor ¿qué? ¡hola!',
  'L’été à l’école', 'das „Wort“ und »so«', 'ａｂｃ　１２３！', 'Ångström ℃ № 5', 'œuvre Æsir ǆ', 'Ⅳ + Ⅷ', 'a→b ⇒ c', 'Việt Nam', 'Đà Nẵng', 'İstanbul’da', 'Ελλάδα: 10,5 εκατ.',
  // combining marks that stay after NFC: they are letters now
  'x' + cp(0x301) + 'y', 'q' + cp(0x308), cp(0x301), cp(0x301) + 'a', ' ' + cp(0x301), ' ' + cp(0x301) + 'a', '!' + cp(0x301), cp(0x301) + '!', '5' + cp(0x301),
  '5' + cp(0x301) + 'a', 'a' + cp(0x301, 0x302, 0x303), "'" + cp(0x301), '\t' + cp(0x301), '(' + cp(0x301) + ')', 'x' + cp(0x20dd), cp(0x488) + 'x', 'ab' + cp(0x334) + 'cd',
  'nai' + cp(0x308) + 've'.normalize('NFC'), 'ǫ' + cp(0x301), 'z' + cp(0x30c) + cp(0x323), 'हिन्दी में लिखा गया वाक्य', 'क्षत्रिय', 'ไม่เป็นไร ครับ', 'สวัสดีค่ะ',
  'السَّلَامُ عَلَيْكُمْ', 'בְּרֵאשִׁית בָּרָא', 'தமிழ் மொழி', 'ಕನ್ನಡ', 'বাংলা ভাষা', 'ગુજરાતી', 'ພາສາລາວ', 'မြန်မာ', 'ཀ྄ྷ', 'ᄒ' + 'ᅡ' + 'ᆫ',
  'Tiếng Việt có dấu: ả ạ ằ ẩ ẵ ặ', 'e' + cp(0x323) + cp(0x302), 'Z̤͔ͧ̑a̴̗l̼̿g̯ő̘', 'a' + cp(0x34f) + 'b', 'x' + cp(0xfe0f), '1' + cp(0xfe0f, 0x20e3),
  // characters of four bytes: emoji, mathematical letters and digits, rare CJK
  'smile 🙂 ok', '🙂🙃', 'a👍b', '👍🏽 thumbs', '👨‍👩‍👧 family', '❤️ love', '🇳🇱 Nederland', '1️⃣ 2️⃣', '🎉🎉🎉 party!', 'I ❤ 🍕 and 🍣',
  '𝟙𝟚 x', '𝒜𝒷 math', '𝐀𝐁𝐂 bold', '𝟎𝟏𝟐', '𠀋 kanji', '𩸽 fish', '𓀀 hieroglyph', '𐌰𐌱 gothic', '🄀 🄁', 'x' + cp(0x1d165) + 'y', cp(0xe0041) + 'tag',
  // other white space and format characters
  `a${cp(0x85)}b`, `a ${cp(0x85)}b`, `a${cp(0x2028)}b`, `a ${cp(0x2029)} b`, `a${cp(0x3000)}b`, `a${cp(0x200b)}b`, `a ${cp(0xfeff)}b`, `${cp(0xfeff)}start`, `a${cp(0x200d)}b`,
  `x${cp(0x2009)}y`, `x ${cp(0x202f)}y`, `${cp(0x1680)}x`, `a${cp(0xad)}b`, `${cp(0x85)}`, `a\x0bb`, `a\x0cb`,
  'What is the difference between a list and a tuple in Python, and when should I use one rather than the other? Please give a short example of each, with comments.',
  'Write a function that takes two numbers, 12 and 3456, and returns their sum; then explain, step by step, why the result is 3468 and not 3467 or 3469. Thanks!',
  'I have been trying to understand how transformers work for weeks now. Can you explain attention, in plain words, without any mathematics at all, as if I were twelve years old?',
  'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox.',
  'a'.repeat(200), 'ab'.repeat(100), ' '.repeat(200), '!'.repeat(200), '7'.repeat(200), 'é'.repeat(100), '語'.repeat(66), "'s".repeat(100), ' a'.repeat(100), '\t'.repeat(200), '🙂'.repeat(50),
  'q7#Kz!m2@Lp9$Xw4%Vn6^Bt8&Hy1*Jr3(Gf5)Dc0_Sa+Ue-Io=Pq[Wl]Ek{Rj}Th|Yg;Uf:Id\'Os"Pa,Am.Sn<Db>Fv/Gc?Hx`Jz~K 1q2w3e4r5t6y7u8i9o0p Q1W2E3R4T5Y6U7I8O9P0 zx!cv@bn#m$ as%df^gh&jk*l( )p_o+i-u=y[t]r{e}w|q ;l:k\'j"h,g.f<d>s/a?',
  '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196',
];
const cut = (q) => { let b = Buffer.from(q, 'utf8'); if (b.length <= 200) return q; let e = 200; while ((b[e] & 0xc0) === 0x80) e--; return b.subarray(0, e).toString('utf8'); };
questions.forEach((q, i) => { questions[i] = cut(q.normalize('NFC')); });       // (marks that NFC does not take stay)
const nouns = ['cat', 'computer', 'ocean', 'mountain', 'recipe', 'algorithm', 'photosynthesis', 'democracy', 'bicycle', 'volcano', 'neutron star', 'sandwich', 'violin', 'glacier', 'mitochondria', 'thunderstorm'];
const names = ['Paris', 'Einstein', 'Amsterdam', 'Shakespeare', 'Mars', 'Python', 'JavaScript', 'Tokyo', 'Mozart', 'the Amazon', 'Antarctica', 'Rembrandt', 'Linux', 'Kilimanjaro', 'Zürich', '東京', 'Москва'];
const adjs = ['largest', 'smallest', 'oldest', 'fastest', 'most common', 'best', 'cheapest', 'strangest', 'healthiest', 'rarest'];
const verbs = ['explain', 'describe', 'summarize', 'compare', 'define', 'translate', 'list', 'calculate', 'simplify', 'rewrite'];
const nl = { adj: ['grootste', 'kleinste', 'oudste', 'mooiste', 'gekste'], noun: ['stad', 'rivier', 'berg', 'fiets', 'molen', 'tulp', 'gracht'], place: ['Nederland', 'Europa', 'de wereld', 'Friesland', 'Zuid-Holland', "'s-Hertogenbosch"] };
const templates = [
  () => `What is the ${pick(adjs)} ${pick(nouns)} in the world?`,
  () => `Can you ${pick(verbs)} how a ${pick(nouns)} works?`,
  () => `Who was ${pick(names)} and why is ${pick(names)} famous?`,
  () => `${pick(verbs).replace(/^./, (c) => c.toUpperCase())} the difference between a ${pick(nouns)} and a ${pick(nouns)}.`,
  () => `How many ${pick(nouns)}s are there in ${pick(names)}? Give ${1 + rnd(9)} examples.`,
  () => `What is ${rnd(1000)} ${pick(['+', '-', '*', '/', 'plus', 'times', 'minus'])} ${rnd(100000)}?`,
  () => `In ${1000 + rnd(1100)}, what happened to ${pick(names)}'s ${pick(nouns)}?`,
  () => `Why don't ${pick(nouns)}s like ${pick(names)}? I'd say it's the ${pick(adjs)} reason, isn't it?`,
  () => `Tell me a joke about a ${pick(adjs)} ${pick(nouns)}, please! ${pick(['😂', '🙂', '🤖', '', '!!'])}`,
  () => `"${pick(names)}" -- is that a ${pick(nouns)} (or a ${pick(nouns)})?`,
  () => `Write ${2 + rnd(8)} lines about ${pick(names)}, ${pick(names)} and ${pick(names)}; keep it under ${10 * (1 + rnd(30))} words.`,
  () => `${pick(names).toUpperCase()}: ${pick(adjs)}, ${pick(adjs)} or ${pick(adjs)}?`,
  () => `Is it true that ${pick(names)} discovered the ${pick(nouns)} at ${1 + rnd(12)}:${rnd(6)}${rnd(10)} on ${1 + rnd(28)}/${1 + rnd(12)}/${1900 + rnd(125)}?`,
  () => `Wat is de ${pick(nl.adj)} ${pick(nl.noun)} van ${pick(nl.place)}?`,
  () => `Hoeveel ${pick(nl.noun)}en zijn er in ${pick(nl.place)}, en welke is de ${pick(nl.adj)}?`,
  () => `Vertel in ${2 + rnd(5)} zinnen iets over ${pick(names)}; is dat de ${pick(nl.adj)} ${pick(nl.noun)}?`,
];
for (let i = 0; i < 160; i++) questions.push(templates[i % templates.length]());
// Random character soup, to stress the merging and the word splitting.
const soup = " etaoinshrdlucmfwypvbgkqjxz.,'?!-0123456789ETAOINSHR\t\"():;/\r";
for (let i = 0; i < 60; i++) {
  let s = '';
  for (let n = 1 + rnd(i < 40 ? 60 : 200); n > 0; n--) s += rnd(3) ? soup[rnd(14)] : soup[rnd(soup.length)];
  questions.push(s);
}
// ... and soup with characters of two, three and four bytes of every class, marks among them
const soup2 = [...' ab\'s.,(1\t', 'é', 'ß', 'я', 'λ', '語', 'の', '。', '，', '—', '’', '“', '€', '²', '½', '٣', NBSP, cp(0x3000), cp(0x2009), cp(0x301), cp(0x5b0), 'ا', 'ह', cp(0x94d), 'ก', cp(0xe49),
  cp(0x308), cp(0x20e3), cp(0xfe0f), cp(0x200d), '🙂', '👍', cp(0x1f3fd), '𝒜', '𝟙', '𠀋', cp(0x17f), cp(0x85), cp(0x2028)];
for (let i = 0; i < 80; i++) {
  let s = '';
  for (let n = 1 + rnd(40); n > 0; n--) s += pick(soup2);
  questions.push(cut(s.normalize('NFC')));
}
// Questions with newlines inside: only for the program built with eol = 0.
const multiline = [
  'line one\nline two', '\n', '\n\n', ' \n', '\n x', ' \n x', 'a\n\nb', 'a \n \n b', 'a.\nb', 'a.\n\n\nb', 'a!\n \nb', 'a?\r\nb', 'a\r\n\r\nb', '\tx\n\ty\n', 'end\n', 'end \n ', 'end.\n',
  '\n\n\nstart', '  \n  start', 'def f(x):\n    return x + 1\n', 'for i in range(10):\n\tprint(i)\n\n# done', '1\n2\n3', '(\n)', 'a\n(b', 'a \n(b', "it\n's", "it's\n'tis",
  'Dear Sir,\n\nPlease explain the following:\n  1. tokens\n  2. merges\n\nThanks!\n', 'Regel een.\nRegel twee, met een komma.\n\nEn een derde alinea: 3 woorden.', 'x\n \n \ny', 'x\t\n\ty', '。\n、', 'é\nü', `a${NBSP}\nb`,
  '!\n\n  x', '!\n \n x', '!!\r\n\r\nx', 'a. \nb', 'a .\nb', '\n' + cp(0x301), cp(0x301) + '\n', '🙂\n🙂', `a${cp(0x85)}\nb`,
];
for (let i = 0; i < 30; i++) {
  let s = '';
  for (let n = 1 + rnd(50); n > 0; n--) s += pick([...' \n\n\r\tab.!(1\'s', 'é', '。', NBSP, cp(0x301), '🙂']);
  multiline.push(s.normalize('NFC'));
}
for (const q of questions) if (utf8len(q) > 200 || q.includes('\n') || q !== q.normalize('NFC')) throw new Error(`a test question does not fit the test: ${JSON.stringify(q)}`);

const want = (q) => tok.encode(tok.chatPrompt(q));

// ---- the reference ------------------------------------------------------------------
{
  console.log('REFERENCE (ref.js)');
  const hello = [248045, 846, 198, 9419, 248046, 198, 248045, 74455, 198, 248068, 271, 248069, 271];
  check(want('Hello').join() === hello.join(), 'ids of the chat prompt for "Hello"');
  console.log(`  chat prompt for "Hello": the published ids: ${want('Hello').join() === hello.join()}; stop tokens ${tok.stop.join(', ')}`);
  let addedOk = 0;
  for (const a of tok.added) {
    const ok = tok.encode(a.text).join() === String(a.id) && tok.encode(`x${a.text}y`).join() === [...tok.encode('x'), a.id, ...tok.encode('y')].join() &&
      tok.decode([a.id]) === (a.special ? '' : a.text) && tok.decode([a.id], { skipSpecial: false }) === a.text;
    if (ok) addedOk++;
    check(ok, `added token ${a.text}`);
  }
  console.log(`  ${addedOk} of ${tok.added.length} added tokens encode to their one id and decode as expected (${tok.added.filter((a) => a.special).length} special ones print nothing)`);
  // the word splitting, worked out by hand from the regular expression
  const M = cp(0x301);
  const split = [
    ["don't", ['don', "'t"]], ["'tis", ["'t", 'is']], [" 's", [" '", 's']], ["!'s", ["!'", 's']], ["\t's", ['\t', "'s"]], ["we'LL", ['we', "'LL"]],
    ['a.b', ['a', '.b']], ['((a', ['((', 'a']], [' (a', [' (', 'a']], ['a  b', ['a', ' ', ' b']], ['a\tb', ['a', '\tb']], ['12', ['1', '2']],
    ['x!\n\n y', ['x', '!\n\n', ' y']], ['a \n  b', ['a', ' \n', ' ', ' b']], ['e.g.', ['e', '.g', '.']],
    ['x' + M + 'y', ['x' + M + 'y']], ['5' + M, ['5', M]], [' ' + M + 'a', [' ' + M + 'a']], ['!' + M, ['!' + M]], [M + '!', [M, '!']], ['(' + M + ')', ['(' + M, ')']],
    ["'" + M, ["'" + M]], ["'s" + M, ["'s", M]], ['a ' + M, ['a', ' ' + M]], ['a  ' + M, ['a', ' ', ' ' + M]], ['!!' + M, ['!!', M]], ['a\t' + M, ['a', '\t' + M]],
    ['x' + cp(0x20dd), ['x' + cp(0x20dd)]], ['1' + cp(0xfe0f, 0x20e3), ['1', cp(0xfe0f, 0x20e3)]], [`it'${cp(0x17f)}`, ['it', `'${cp(0x17f)}`]],
  ];
  let splitOk = 0;
  for (const [text, words] of split) { const ok = tok.splitWords(text).join('|') === words.join('|'); if (ok) splitOk++; check(ok, `split ${JSON.stringify(text)} -> ${JSON.stringify(tok.splitWords(text))}`); }
  console.log(`  ${splitOk} of ${split.length} hand-made word splitting cases (combining marks among them)`);
  const texts = [...questions, ...multiline, ...questions.map((q) => tok.chatPrompt(q))];
  const round = texts.filter((x) => tok.decode(tok.encode(x), { skipSpecial: false }) === x.normalize('NFC')).length;
  check(round === texts.length, 'round trip');
  console.log(`  decode(encode(x)) === x for ${round} of ${texts.length} texts`);
  // float.js: the same ids, except where JavaScript's \s is not Unicode's White_Space, or (?i) folds a letter
  const F = require('../reference/float').loadTokenizer(tok.dir);
  const all = [...questions, ...multiline];
  const diff = all.filter((q) => F.encode(F.chatPrompt(q)).join() !== want(q).join());
  const known = (q) => /[\u0085\ufeff\u017f]/.test(q);
  check(F.chatPrompt('x') === tok.chatPrompt('x') && F.stop.join() === tok.stop.join(), 'float.js: chat prompt and stop tokens');
  check(diff.every(known), 'float.js: ids');
  console.log(`  float.js: same chat prompt and stop tokens; same ids for ${all.length - diff.length} of ${all.length} texts; ` +
    `the ${diff.length} others hold U+0085, U+FEFF or U+017F (float.js: \\s of JavaScript and 's without (?i)): ${diff.filter((q) => !known(q)).length} other differences`);
}

// ---- the stream and the programs ----------------------------------------------------
const t0 = now();
const { bytes: stream, info } = packTokenizer();
console.log(`\nDATA: stream ${fmt(stream.length)} bytes, packed in ${((now() - t0) / 1000).toFixed(1)} s; ids 0..${info.vocab - 1}: ${fmt(info.merges)} merges, ` +
  `${info.unmade} tokens no merge makes and ${tok.added.filter((a) => !a.special).length} added tokens that are printed through ${info.fakeSlots} pairs of their own; ` +
  `hash load ${info.hashLoad.toFixed(2)}, ${info.probesPerHit.toFixed(2)} slots per stored pair (worst ${info.worstProbes}), ${info.probesPerMiss.toFixed(2)} per pair that is not there; ` +
  `${info.classTables} class tables; deepest PRINT stack ${info.stackDepth}`);
console.log(`  template: ${info.prefix.length} ids, the question after "\\n" (198), ${info.suffix.length} ids: ${JSON.stringify(info.prefix)} 198 ... ${JSON.stringify(info.suffix)}`);
const data = Buffer.from(stream);
const BASE = 20;                              // not at cell 0, to prove it can be embedded; cells 0..19 are the test's own
const L = G.layout(BASE);
const pure = (src) => { check(!/[^+\-<>[\].,]/.test(src), 'not pure brainfuck'); return src; };
const build = (fn, lay = L) => { const p = new Patterns(32); fn(p, lay); return pure(p.toString()); };

// Out: id + 1 as three bytes, high byte first; X ends 0.
const outThree = (p, X, s) => {
  const [b0, b1, b2, ...hs] = s;
  p.requantCore(X, [{ cell: b0, bits: 8 }, { cell: b1, bits: 8 }, { cell: b2, bits: 8 }], 0, 24, false, hs);
  p.out(b2).clear(b2).out(b1).clear(b1).out(b0).clear(b0);
};
const readThree = (p, X, T) => { p.read(X); p.scatter(X, [[T, 256]]); p.read(X); p.move(X, T); p.scatter(T, [[X, 256]]); p.read(T); p.move(T, X); };
const scratch = Array.from({ length: 13 }, (_, i) => 4 + i);

// LOAD; then for every question line: ENCODE, write the ids + 1 (three bytes each) and 0 0 0, read one more byte: go on if it is not 0.
const chatSrc = (lay) => build((p, l) => {
  const GO = 0, N = 1, X = 2;
  G.emitLoad(p, l);
  p.add(GO, 1);
  p.loop(GO, () => {
    p.clear(GO);
    G.emitEncode(p, l);
    p.copy(l.count, N, scratch[0]);
    p.loop(N, () => { p.add(N, -1); G.emitPopId(p, l, X); p.add(X, 1); outThree(p, X, scratch); });
    p.out(X).out(X).out(X);
    p.read(GO);
  });
}, lay);
// LOAD; read id + 1 as three bytes (0 = stop), print the token, write byte 255; again.
const printSrc = (withPrint) => build((p, l) => {
  const X = 0, T = 1;
  G.emitLoad(p, l);
  readThree(p, X, T);
  p.loop(X, () => { p.add(X, -1); if (withPrint) G.emitPrint(p, l, X, { tmp: T }); p.clear(X); p.add(T, 255).out(T).clear(T); readThree(p, X, T); });
});
// LOAD; read a count byte; ENCODE that many lines (for the time of one ENCODE).
const repeatSrc = build((p, l) => { G.emitLoad(p, l); p.read(0); p.loop(0, () => { p.add(0, -1); G.emitEncode(p, l); }); });
const srcLoad = build((p, l) => G.emitLoad(p, l));
const srcChat = chatSrc(L), srcPrint = printSrc(true), srcPrintBase = printSrc(false);
const sizeOf = (fn) => { const p = new Patterns(32); p.ptr = L.T0; fn(p); return p.toString().length; };
console.log(`PROGRAM TEXT: LOAD ${fmt(srcLoad.length)}, ENCODE ${fmt(sizeOf((p) => G.emitEncode(p, L)))} (of which the pair lookup ${fmt(sizeOf((p) => G.emitPairLookup(p, L)))}), ` +
  `PRINT ${fmt(sizeOf((p) => G.emitPrint(p, L, BASE + 2, { tmp: BASE + 3 })))} characters`);
console.log(`TAPE: ${fmt(L.size)} cells for the tokenizer: table ${fmt(L.tapeSize - L.T0)} (${fmt(L.slots)} records of ${G.RC} cells in blocks of ${L.U}), ` +
  `byte and class tables ${fmt(L.BH - L.base)}, everything else ${fmt(L.T0 - L.BH)}`);

if (process.argv.includes('write')) {
  const OUT = path.join(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'tokenizer.bin'), data);
  fs.writeFileSync(path.join(OUT, 'encode.bf'), chatSrc(G.layout(BASE)));
  fs.writeFileSync(path.join(OUT, 'print.bf'), srcPrint);
  console.log(`  written: ${OUT}/tokenizer.bin, encode.bf, print.bf`);
}

const wo = { cellBits: 32, tapeSize: L.tapeSize };
const tc = now();
const [wLoad, wChat, wPrint, wPrintBase, wRep] = [srcLoad, srcChat, srcPrint, srcPrintBase, repeatSrc].map((s) => BFWasm.compileSync(s, wo));
console.log(`WebAssembly: five test programs compiled in ${fmt(now() - tc)} ms`);
const best = (fn, n = 3) => { let b = Infinity, out; for (let i = 0; i < n; i++) { const t = now(); out = fn(); b = Math.min(b, now() - t); } return { out, ms: b }; };

// ---- LOAD ------------------------------------------------------------------------
const loaded = best(() => wLoad.run(data), 3);
const clean = Uint32Array.from(wLoad.tape());
check(loaded.out.pointer === L.T0, 'pointer after LOAD');
{
  let outside = 0;
  for (let a = 0; a < L.tapeSize; a++) if (clean[a] && !L.isData(a)) outside++;
  check(outside === 0, `data outside the data cells (${outside} cells)`);
  const r = interp(compile(srcLoad), data, L.tapeSize);
  let same = r.pointer === L.T0;
  for (let a = 0; a < L.tapeSize && same; a++) if (r.tape[a] !== clean[a]) same = false;
  check(same, 'the interpreter and WebAssembly load the same tape');
  console.log(`\nLOAD: ${fmt(r.steps)} steps (${(r.steps / data.length).toFixed(2)} per byte), ${loaded.ms.toFixed(0)} ms under WebAssembly`);
}
const dirtyCells = (tape, allowOut, ref = clean, lay = L) => {
  let n = 0;
  for (let a = 0; a < lay.tapeSize; a++) if (tape[a] !== ref[a] && !(allowOut && a >= lay.OUTG && a < lay.WSENT)) n++;
  return n;
};

// ---- ENCODE ------------------------------------------------------------------------
const idsOf = (out) => {           // the output of the chat program: lists of ids + 1 (3 bytes each), each list ended by 0 0 0
  const lists = [[]];
  for (let i = 0; i + 2 < out.length; i += 3) {
    const v = out[i] * 65536 + out[i + 1] * 256 + out[i + 2];
    if (v) lists[lists.length - 1].push(v - 1); else lists.push([]);
  }
  lists.pop();
  return lists;
};
const linesInput = (qs, eol = '\n', d = data) => Buffer.concat([d, ...qs.map((q, i) => Buffer.concat([Buffer.from(q, 'utf8'), Buffer.from(eol + (i + 1 < qs.length ? '\x01' : ''), 'latin1')]))]);
{
  const r = wChat.run(linesInput(questions));
  const got = idsOf(r.output);
  let exact = 0;
  questions.forEach((q, k) => {
    const ok = got[k] && got[k].join() === want(q).join();
    if (ok) exact++;
    check(ok, `encode ${JSON.stringify(q)}:\n   got  ${got[k] && got[k].slice(info.prefix.length)}\n   want ${want(q).slice(info.prefix.length)}`);
  });
  check(got.length === questions.length, 'one list of ids per question');
  const tape = wChat.tape();
  check(dirtyCells(tape, true) === 0, 'scratch not zero after all questions');
  console.log(`\nENCODE: ${exact} of ${questions.length} questions give exactly the ids of ref.js (whole chat prompt, one WebAssembly run of the chat program); scratch zero afterwards: ${dirtyCells(tape, true) === 0}`);
  check(want('x').slice(0, 3).join() === info.fixed.join() && questions.every((q) => want(q).slice(0, 3).join() === info.fixed.join()), 'fixed start of the prompt');
  console.log(`  every prompt starts with the same ${info.fixed.length} ids ${JSON.stringify(info.fixed)} (the "\\n" before the question never merges with it)`);
}
// one question at a time under the interpreter: steps, the count, the pointer, the scratch cells
const progChat = compile(srcChat), steps = [], perByte = [], long = [];
{
  const some = questions.filter((q, i) => i % 3 === 0 || utf8len(q) >= 190);
  let good = 0;
  const base = interp(compile(srcLoad), data, L.tapeSize).steps;              // (the steps below include writing the ids out)
  for (const q of some) {
    const r = interp(progChat, linesInput([q]), L.tapeSize);
    const ok = idsOf(r.output)[0].join() === want(q).join() && r.tape[L.count] === want(q).length && dirtyCells(r.tape, true) === 0;
    if (ok) good++;
    check(ok, `encode under the interpreter ${JSON.stringify(q)}`);
    const st = r.steps - base;
    steps.push(st);
    if (utf8len(q)) perByte.push(st / utf8len(q));
    if (utf8len(q) >= 190) long.push({ q, steps: st });
  }
  console.log(`  under the interpreter: ${good} of ${some.length} exact, with the right count and the scratch zero; steps per question ${stats(steps)}; per byte ${stats(perByte)}`);
}

// the texts of tokens as questions: every 40th token, the tokens of the 27 merges with a part made by a later merge, the 201 tokens no merge makes
{
  const t = JSON.parse(fs.readFileSync(path.join(tok.dir, 'tokenizer.json'), 'utf8')), v = t.model.vocab;
  const later = [];
  t.model.merges.forEach((mg) => { const [a, b] = Array.isArray(mg) ? mg : mg.split(' '); if (v[a] > v[a + b] || v[b] > v[a + b]) later.push(v[a + b]); });
  const madeIds = new Set(t.model.merges.map((mg) => { const [a, b] = Array.isArray(mg) ? mg : mg.split(' '); return v[a + b]; }));
  const unmade = []; for (let id = 256; id < tok.merges + 256 + 201; id++) if (!madeIds.has(id)) unmade.push(id);
  const ids = [...new Set([...Array.from({ length: Math.ceil(info.bpeTokens / 40) }, (_, i) => 40 * i), ...later, ...unmade])];
  const texts = [];
  for (const id of ids) {
    const b = Buffer.from(tok.tokenBytes(id)), q = b.toString('utf8');
    if (b.length && b.length <= 200 && !b.includes(10) && !b.includes(0) && Buffer.from(q, 'utf8').equals(b)) texts.push(q);
  }
  const raw = (q) => [...info.prefix, ...tok.encodePlain('\n' + q, { nfc: false }), ...info.suffix];
  const got = idsOf(wChat.run(linesInput(texts)).output);
  const good = texts.filter((q, k) => got[k] && got[k].join() === raw(q).join()).length;
  const nfc = texts.filter((q) => q === q.normalize('NFC') && !/<\||<\/?(think|tool_)/.test(q));
  check(good === texts.length, 'texts of tokens');
  check(nfc.every((q) => raw(q).join() === want(q).join()), 'texts of tokens: the reference with and without NFC');
  check(later.length === 27 && unmade.length === 201, 'the 27 and the 201 tokens');
  for (const [k, q] of texts.entries()) if (!(got[k] && got[k].join() === raw(q).join())) check(false, `token text ${JSON.stringify(q)}: got ${got[k]}, want ${raw(q)}`);
  console.log(`  the texts of ${fmt(texts.length)} tokens as questions (every 40th token, the 27 merges with a part from a later merge, the 201 tokens no merge makes; the ones that are UTF-8 and have no newline): ${fmt(good)} exact`);
}

// the program built with eol = 0: the question is everything up to the end of the input
{
  const L0 = G.layout(7, { eol: 0 }), w0 = BFWasm.compileSync(build((p, l) => { G.emitLoad(p, l); G.emitEncode(p, l); }, L0), { cellBits: 32, tapeSize: L0.tapeSize });
  const clean0 = Uint32Array.from((w0.run(data), w0.tape()));
  const all = [...multiline, ...questions.filter((_, i) => i % 11 === 0)];
  let good = 0;
  for (const q of all) {
    w0.run(Buffer.concat([data, Buffer.from(q, 'utf8')]));
    const tape = w0.tape(), ids = [];
    for (let i = 0; tape[L0.OUT + 3 * i] !== 0; i++) ids.push(tape[L0.OUT + 3 * i + 1]);
    const ok = ids.join() === want(q).join() && dirtyCells(tape, true, clean0, L0) === 0;
    if (ok) good++;
    check(ok, `encode (eol 0) ${JSON.stringify(q)}:\n   got  ${ids.slice(info.prefix.length)}\n   want ${want(q).slice(info.prefix.length)}`);
  }
  console.log(`  questions with newlines inside (program built with eol = 0): ${good} of ${all.length} exact (${multiline.length} of them on several lines)`);
}

// what the program reads is bytes: no NFC, no added tokens in the text
{
  const enc = (bytes) => idsOf(wChat.run(Buffer.concat([data, Buffer.from(bytes), Buffer.from('\n')])).output)[0];
  const odd = Buffer.from([0x61, 0x01, 0x7f, 0x80, 0xff, 0xc3, 0x28, 0xe2, 0x82, 0x62, 0xf0, 0x9f, 0xcc, 0x41, 0xf4, 0x90, 0x80, 0x80]);
  const got = enc(odd).slice(info.prefix.length, -info.suffix.length);
  const back = Buffer.from(got.flatMap((id) => tok.tokenBytes(id))).equals(Buffer.concat([Buffer.from('\n'), odd]));
  check(back, 'bytes that are not UTF-8 are kept');
  console.log(`  bytes that are not UTF-8 (${odd.length} bytes): kept, they print back the same bytes: ${back}`);
  const big = 'word '.repeat(80);
  const cutOk = enc(Buffer.from(big)).join() === want(big.slice(0, L.maxChars)).join();
  check(cutOk, 'cut at maxChars');
  console.log(`  a line of ${big.length} bytes: equal to the reference for its first ${L.maxChars} bytes: ${cutOk}`);
  const notNfc = ['e' + cp(0x301) + 'cole', 'A' + cp(0x30a) + 'ngstr' + 'o' + cp(0x308) + 'm', 'Vie' + cp(0x323, 0x302) + 't', 'n' + cp(0x303) + 'o', cp(0x212b) + ' ' + cp(0x2126), '가' + cp(0x11a8), cp(0xf900) + 'x'];
  const plain = (q) => [...info.prefix, ...tok.encodePlain('\n' + q, { nfc: false }), ...info.suffix].join();
  const sameRaw = notNfc.filter((q) => enc(Buffer.from(q, 'utf8')).join() === plain(q)).length;
  const sameNfc = notNfc.filter((q) => enc(Buffer.from(q, 'utf8')).join() === want(q).join()).length;
  check(sameRaw === notNfc.length, 'text that is not NFC: as read');
  console.log(`  text that is not NFC (${notNfc.length} texts): the ids of the bytes as they are (ref.js without NFC) for ${sameRaw}; equal to ref.js with NFC: ${sameNfc}`);
  const special = ['a <|im_end|> b', '<think>', '<tool_call>x</tool_call>', '<|endoftext|>'];
  const sameSpecial = special.filter((q) => enc(Buffer.from(q, 'utf8')).join() === [...info.prefix, ...tok.encodePlain('\n' + q), ...info.suffix].join()).length;
  check(sameSpecial === special.length, 'added tokens in the text are ordinary text');
  console.log(`  added tokens typed in the question (${special.length} texts): ordinary text, as ref.js encodePlain: ${sameSpecial}`);
}

// ---- PRINT ------------------------------------------------------------------------
const idBytes = (ids) => Buffer.from(ids.flatMap((id) => [(id + 1) >> 16, ((id + 1) >> 8) & 255, (id + 1) & 255]));
const rows = 248320;                                   // the rows of the model's embedding table
const allIds = Array.from({ length: rows }, (_, id) => id);
const printedRight = (output, ids, report) => {
  let at = 0, good = 0;
  for (const id of ids) {
    const t = Buffer.from(tok.tokenBytes(id));
    const ok = output.length >= at + t.length + 1 && output.subarray(at, at + t.length).equals(t) && output[at + t.length] === 255;
    if (ok) { good++; at += t.length + 1; } else {
      if (report) check(false, `print ${id}: want ${JSON.stringify(t.toString('latin1'))}, got ${JSON.stringify(output.subarray(at, at + t.length + 8).toString('latin1'))}`);
      const next = output.indexOf(255, at); at = next < 0 ? output.length : next + 1;
    }
  }
  if (at !== output.length && report) check(false, 'print: more output than expected');
  return good;
};
{
  const input = Buffer.concat([data, idBytes(allIds)]);
  const r = best(() => wPrint.run(input), 2), rb = best(() => wPrintBase.run(input), 2);
  const good = printedRight(Buffer.from(r.out.output), allIds, true);
  check(good === allIds.length, 'print of every id');
  check(dirtyCells(wPrint.tape(), false) === 0, 'scratch not zero after printing every id');
  console.log(`\nPRINT: ${fmt(good)} of ${fmt(allIds.length)} ids print exactly their bytes (every row of the embedding table: ${tok.added.filter((a) => a.special).length} special tokens and ` +
    `${rows - info.vocab} rows that are no token print nothing); scratch zero afterwards; ${((r.ms - rb.ms) / allIds.length * 1000).toFixed(2)} microseconds per token (WebAssembly)`);
  const sample = want('What is the capital of France?').concat(tok.encode(' The capital of France is Paris — a city of 2,102,650 people (2023). 🇫🇷\nIt lies on the Seine.<tool_call></think>'));
  const out = Buffer.from(wPrint.run(Buffer.concat([data, idBytes(sample)])).output).toString('latin1').split('\xff').join('');
  check(Buffer.from(out, 'latin1').toString('utf8') === tok.decode(sample), 'decode of a sequence');
  // steps of single tokens = (run that prints it) - (run that only reads it)
  const pP = compile(srcPrint), pB = compile(srcPrintBase);
  const one = (id) => interp(pP, Buffer.concat([data, idBytes([id])]), L.tapeSize).steps - interp(pB, Buffer.concat([data, idBytes([id])]), L.tapeSize).steps;
  const answer = tok.encode('The capital of France is Paris. It is known for the Eiffel Tower, its museums and its cafés. Paris has about two million inhabitants, and the river Seine runs through the middle of the city.');
  const st = answer.map(one);
  const textLen = (id) => tok.tokenBytes(id).length;
  const longestId = allIds.reduce((a, b) => (textLen(b) > textLen(a) ? b : a));
  console.log(`  tokens of an ordinary answer (${answer.length} tokens, ${(answer.reduce((n, id) => n + textLen(id), 0) / answer.length).toFixed(1)} bytes each): steps per token ${stats(st)}`);
  console.log(`  a byte (id 0): ${fmt(one(0))} steps; a special token (${tok.stop[0]}): ${fmt(one(tok.stop[0]))}; "<think>" (248068): ${fmt(one(248068))}; ` +
    `a token no merge makes (${104328}): ${fmt(one(104328))}; the longest text (id ${longestId}, ${textLen(longestId)} bytes): ${fmt(one(longestId))} steps`);
}

// ---- other sizes -----------------------------------------------------------------
{
  const variants = [{ hiBits: 8, midBits: 6, loBits: 5, maxChars: 120, eol: 13 }, { hiBits: 6, midBits: 7, loBits: 6, maxPre: 6, maxSuf: 16, subTables: 700, stackCap: 10 }];
  for (const o2 of variants) {
    const L2 = G.layout(3, o2), d2 = Buffer.from(packTokenizer(o2).bytes), eol = String.fromCharCode(L2.eol);
    const opt2 = { cellBits: 32, tapeSize: L2.tapeSize };
    const chat2 = BFWasm.compileSync(chatSrc(L2), opt2), print2 = BFWasm.compileSync(build((p, l) => {
      const X = 0, T = 1;
      G.emitLoad(p, l);
      readThree(p, X, T);
      p.loop(X, () => { p.add(X, -1); G.emitPrint(p, l, X, { tmp: T }); p.clear(X); p.add(T, 255).out(T).clear(T); readThree(p, X, T); });
    }, L2), opt2);
    const qs = questions.filter((q, i) => i % 7 === 0 && utf8len(q) <= L2.maxChars && !q.includes(eol));
    const got = idsOf(chat2.run(linesInput(qs, eol, d2)).output);
    const good = qs.filter((q, k) => got[k] && got[k].join() === want(q).join()).length;
    const some = allIds.filter((id) => id % 7 === 0 || id >= info.vocab - 30);
    const goodP = printedRight(Buffer.from(print2.run(Buffer.concat([d2, idBytes(some)])).output), some, false);
    check(good === qs.length && goodP === some.length, `other sizes ${JSON.stringify(o2)}`);
    console.log(`${o2 === variants[0] ? '\n' : ''}other sizes ${JSON.stringify(o2)}: ${good} of ${qs.length} questions and ${fmt(goodP)} of ${fmt(some.length)} ids exact; stream ${fmt(d2.length)} bytes, tape ${fmt(L2.size)} cells`);
  }
}

// ---- the merge table ---------------------------------------------------------------
if (!quick) {
  // LOAD; read a + 1 and b + 1 (three bytes each; 0 = stop), write the token of the pair + 1 (0: none)
  const w = BFWasm.compileSync(build((p, l) => {
    const T = 0, X = 1;
    G.emitLoad(p, l);
    readThree(p, l.pairA, T);
    p.loop(l.pairA, () => {
      readThree(p, l.pairB, T); G.emitPairLookup(p, l);
      p.move(l.pairA, X); p.add(X, 1); outThree(p, X, scratch);
      readThree(p, l.pairA, T);
    });
  }), wo);
  const t = JSON.parse(fs.readFileSync(path.join(tok.dir, 'tokenizer.json'), 'utf8')), v = t.model.vocab;
  const pairs = t.model.merges.map((mg) => { const [a, b] = Array.isArray(mg) ? mg : mg.split(' '); return [v[a], v[b], v[a + b]]; });
  const known = new Set(pairs.map(([a, b]) => a * 262144 + b));
  const misses = [];
  while (misses.length < 50000) {
    const a = rnd(misses.length % 2 ? 300 : info.vocab), b = rnd(misses.length % 3 ? 300 : info.vocab);
    if (!known.has(a * 262144 + b)) misses.push([a, b, G.NONE]);
  }
  const three = (x) => [x >> 16, (x >> 8) & 255, x & 255];
  const runPairs = (list) => w.run(Buffer.concat([data, Buffer.from(list.flatMap(([a, b]) => [...three(a + 1), ...three(b + 1)]))]));
  const val = (out, i) => out[3 * i] * 65536 + out[3 * i + 1] * 256 + out[3 * i + 2];
  const good = (r, list) => list.filter(([, , x], i) => val(r.output, i) === x + 1).length;
  const th = now(), hit = runPairs(pairs), tHit = now() - th;
  const tm = now(), miss = runPairs(misses), tMiss = now() - tm;
  check(good(hit, pairs) === pairs.length, 'lookup of every merge');
  check(good(miss, misses) === misses.length, 'lookup of pairs that do not merge');
  check(dirtyCells(w.tape(), false) === 0, 'scratch not zero after lookups');
  console.log(`\nMERGE TABLE: ${fmt(good(hit, pairs))} of ${fmt(pairs.length)} merges found, ${fmt(good(miss, misses))} of ${fmt(misses.length)} other pairs answered "none"; ` +
    `${(1000 * (tHit - loaded.ms) / pairs.length).toFixed(1)} and ${(1000 * (tMiss - loaded.ms) / misses.length).toFixed(1)} microseconds per lookup (WebAssembly)`);
}

// ---- timings ------------------------------------------------------------------------
if (!quick) {
  const REP = 20, repeated = (q) => Buffer.concat([data, Buffer.from([REP]), Buffer.from((q + '\n').repeat(REP), 'utf8')]);
  const zero = Buffer.concat([data, Buffer.from([0])]);
  const t0r = best(() => wRep.run(zero), 5).ms;
  const time = (q) => (best(() => wRep.run(repeated(q)), 3).ms - t0r) / REP;
  const typical = questions.filter((q) => utf8len(q) >= 20 && utf8len(q) <= 80 && !/[^\x20-\x7e]/.test(q)).filter((_, i) => i % 10 === 0).map(time);
  console.log(`\nTIME (WebAssembly): LOAD ${loaded.ms.toFixed(0)} ms; ENCODE of a typical question (ASCII, 20..80 bytes, ${typical.length} timed) ${(typical.reduce((a, b) => a + b, 0) / typical.length).toFixed(2)} ms`);
  const big = [...long.map((l) => l.q), 'What is the difference between a list and a tuple in Python, and when should I use one rather than the other? Please give a short example of each, with comments.'];
  for (const q of [...new Set(big)].slice(0, 14)) {
    const l = long.find((x) => x.q === q);
    console.log(`  ${String(utf8len(q)).padStart(3)} bytes, ${String(want(q).length - info.prefix.length - info.suffix.length).padStart(3)} tokens: ENCODE ${time(q).toFixed(2).padStart(6)} ms` +
      `${l ? `, ${fmt(l.steps).padStart(11)} steps` : ''}   ${JSON.stringify(q.slice(0, 40))}${q.length > 40 ? '...' : ''}`);
  }
}

console.log(`\n${checks - failed} of ${checks} checks passed${failed ? `, ${failed} FAILED` : ''}`);
