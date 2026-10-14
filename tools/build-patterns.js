'use strict';
// Writes the pages of site/patterns/ from site/patterns/data.js.
const fs = require('fs');
const path = require('path');
const PAGES = path.join(__dirname, '..', 'site', 'patterns');
const core = require('../site/patterns/core');
const data = require('../site/patterns/data');
const V = require('../site/patterns/view');
const G = { Emitter: require('../site/runtime/emit').Emitter, Patterns: require('../site/runtime/patterns').Patterns };
const { esc, fmt } = V;

// the ?v= of the files the pages load: site.css and site.js as the start page has them, so they never fall behind
const HOME = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const versionOf = (file) => HOME.match(new RegExp(file.replace('.', '\\.') + '\\?v=(\\w+)'))[1];
const VERSION = { siteCss: versionOf('site.css'), siteJs: versionOf('site.js'), ui: 'r7', own: 'r7' };
const ICON ="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d0e10'/%3E%3Cg font-size='17' font-family='monospace' font-weight='700' text-anchor='middle'%3E%3Ctext x='6' y='22' fill='%23cc79a7'%3E[%3C/text%3E%3Ctext x='16' y='22' fill='%23e69f00'%3E+%3C/text%3E%3Ctext x='26' y='22' fill='%23cc79a7'%3E]%3C/text%3E%3C/g%3E%3C/svg%3E";
const groupOf = (p) => data.GROUPS.find((g) => g.id === p.group);
const bitsOf = (v) => core.widths(v)[0];
const words = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

function page({ title, desc, body, cls }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>brnfck.chat: ${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<!-- The pages of the code patterns are written by tools/build-patterns.js from site/patterns/data.js: change those, then run node tools/build-patterns.js. -->
<script>try { document.documentElement.dataset.theme = localStorage.getItem('brnfck.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { document.documentElement.dataset.theme = 'light'; }</script>
<link rel="icon" href="${ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<link rel="stylesheet" href="../site.css?v=${VERSION.siteCss}">
<link rel="stylesheet" href="../ui/system.css?v=${VERSION.ui}">
<link rel="stylesheet" href="../ui/article.css?v=${VERSION.ui}">
<link rel="stylesheet" href="../ui/patterns.css?v=${VERSION.ui}">
</head>
<body>
<script src="../site.js?v=${VERSION.siteJs}" data-section="play"></script>
<main class="doc article patterns ${cls}" id="main">
${body}
</main>
<script src="core.js?v=${VERSION.own}"></script>
<script src="data.js?v=${VERSION.own}"></script>
<script src="view.js?v=${VERSION.own}"></script>
<script src="../ui/article.js?v=${VERSION.ui}"></script>
<script src="ui.js?v=${VERSION.own}"></script>
</body>
</html>
`;
}

const playURL = (code, labels) => {
  const names = Object.keys(labels || {}).slice(0, 12).map((a) => a + ':' + String(labels[a]).replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/ +/g, '-')).filter((s) => !/:$/.test(s)).join(',');
  return '../playground/?code=' + encodeURIComponent(code) + (names ? '&names=' + encodeURIComponent(names).replace(/%3A/g, ':').replace(/%2C/g, ',') : '');
};

const contents = (items) => `<div class="top-nav">
      <nav aria-labelledby="contents-h">
        <p class="label" id="contents-h">Contents</p>
        <ol class="contents">
          ${items.map(([id, name]) => `<li><a href="#${id}">${name}</a></li>`).join('\n          ')}
        </ol>
      </nav>
    </div>`;

const figureOf = (p, v) => `<figure class="fig col" id="fig-${p.id}-${v.id}" data-p="${p.id}" data-v="${v.id}" aria-label="The form ${esc(v.name)} of ${esc(lower(p.name))}, running on a few cells">
      <p class="measured">The figure needs JavaScript. The program below is the result for the example values.</p>
    </figure>`;
function codeOf(p, v, pic) {
  const code = pic.r.code;
  return `<div class="code" data-fig="fig-${p.id}-${v.id}">
      <pre class="bf listing" tabindex="0" data-code aria-label="The program text">${esc(code)}</pre>
      <div class="ctl"><button type="button" class="primary" data-copy>Copy</button><a class="btn quiet" data-play href="${esc(playURL(code, pic.labels))}">Open in the playground</a><span class="count" data-len>${words(code.length, 'character', 'characters')}</span><span class="sr-only" role="status" data-said></span></div>
    </div>`;
}
function pictureOf(p, v) {
  const pic = core.picture(v, core.defaults(v), bitsOf(v), G);
  if (!pic.r.ok) throw new Error(p.id + '/' + v.id + ': ' + pic.r.problems.join('; '));
  return pic;
}

// "Press Play ..." for the figure of a form: what it is, and what can be changed.
function introOf(v, pic) {
  const cells = pic.items.filter((a) => a >= 0), names = [];
  for (const a of cells) { const n = pic.labels[a]; if (n !== undefined && !names.includes(n)) names.push(n); }
  const fields = core.fields(v), num = fields.filter((f) => !f.type), other = fields.filter((f) => f.type);
  const change = [];
  if (num.length) change.push('change ' + list(num.map((f) => f.label)) + ' with the slider' + (num.length > 1 ? 's' : ''));
  if (other.length) change.push('edit ' + list(other.map((f) => (f.type === 'choice' ? 'the choice of ' + f.label : f.label))));
  const span = cells[cells.length - 1] - cells[0] + 1, count = span <= 36 ? span : cells.length;   // as the figure in ui.js
  const named = names.length ? list(names.map((n) => '“' + esc(n) + '”')) : '';
  return `The form “${esc(v.name)}” works on ${count === 1 ? 'one cell' : words(count, 'cell', 'cells')}${!named ? '' : names.length < count ? '; the named ones are ' + named : ', named ' + named}. `
    + `Press <em>Play</em>, drag the step slider forwards and back${change.length ? ', or ' + list(change) : ''}:`;
}

function measuredRows(p) {
  const rows = [];
  for (const v of p.variants) {
    const bits = bitsOf(v);
    for (const row of v.table || [core.defaults(v)]) {
      const vals = Object.assign(core.defaults(v), row);
      if (!core.allowed(v, vals, bits)) throw new Error(p.id + '/' + v.id + ': table row not allowed ' + JSON.stringify(row));
      const r = core.bench(v, vals, bits, G, { plainMax: 3e7, fastMax: 3e7 });
      if (!r.ok) throw new Error(p.id + '/' + v.id + ' ' + JSON.stringify(row) + ': ' + r.problems.join('; '));
      rows.push(`<tr><td>${esc(v.name)}</td><td>${esc(V.valuesText(v, vals))}</td><td class="n">${bits}</td><td class="n">${fmt(r.code.length)}</td><td class="n">${r.plain === null ? 'more than 30,000,000' : fmt(r.plain)}</td><td class="n">${fmt(r.fast)}</td></tr>`);
    }
  }
  return rows.join('\n');
}

function compareBlock(p) {
  const c = p.compare;
  if (!c) return '';
  const main = p.variants[0], base = p.variants.find((v) => v.baseline);
  const bits = c.bits || core.widths(main).find((b) => core.widths(base).includes(b));
  const rows = [], bars = [];
  for (const row of c.rows) {
    const a = core.bench(main, Object.assign(core.defaults(main), row), bits, G, { plainMax: 3e7, fastMax: 3e7 });
    const b = core.bench(base, Object.assign(core.defaults(base), row), bits, G, { plainMax: 3e7, fastMax: 3e7 });
    if (!a.ok || !b.ok) throw new Error(p.id + ' compare ' + JSON.stringify(row) + ': ' + a.problems.concat(b.problems).join('; '));
    const what = V.valuesText(main, Object.assign(core.defaults(main), row));
    const pl = (r) => (r.plain === null ? 'more than 30,000,000' : fmt(r.plain));
    rows.push(`<tr><td>${esc(what)}</td><td class="n">${fmt(a.fast)}</td><td class="n">${fmt(b.fast)}</td><td class="n">${pl(a)}</td><td class="n">${pl(b)}</td><td class="n">${fmt(a.code.length)}</td><td class="n">${fmt(b.code.length)}</td></tr>`);
    if (c.chars) bars.push({ label: 'this pattern, characters', value: a.code.length, kind: 'fast' }, { label: 'the naive way, characters', value: b.code.length, kind: 'plain' });
    else bars.push({ label: 'this pattern: ' + what, value: a.fast, kind: 'fast' }, { label: 'the naive way: ' + what, value: b.fast, kind: 'plain' });
  }
  return `<h3>Against the naive way</h3>
    <p>${c.text}</p>
    <details class="q fold" id="compare"><summary>The numbers, row by row</summary><div class="a">
      ${V.barsHTML(bars.slice(-2))}
      <p class="measured">This pattern against the naive way, on ${bits}-bit cells, measured when this page was written. The bars show the last row: ${c.chars ? 'the length of the two program texts' : 'optimised steps'}.</p>
      <div class="scroll" tabindex="0" role="region" aria-label="This pattern against the naive way"><table>
        <thead><tr><th rowspan="2">Values</th><th colspan="2">Optimised steps</th><th colspan="2">Plain steps</th><th colspan="2">Characters</th></tr>
        <tr><th class="n">pattern</th><th class="n">naive</th><th class="n">pattern</th><th class="n">naive</th><th class="n">pattern</th><th class="n">naive</th></tr></thead>
        <tbody>${rows.join('\n')}</tbody></table></div>
    </div></details>
    ${c.project ? `<p>${c.project} <span class="ev">measured in the project</span></p>` : ''}`;
}

function lessonStrip(i, end) {
  const prev = data.PATTERNS[i - 1], next = data.PATTERNS[i + 1];
  return `<nav class="lesson${end ? ' end' : ''}" aria-label="Pattern${end ? ', end of page' : ''}">
    <p class="course">Code patterns</p>
    <p class="count">Pattern <b>${i + 1}</b> of ${data.PATTERNS.length}</p>
    ${prev ? `<a class="prev" href="${prev.id}.html" rel="prev"><span>Previous</span>${esc(prev.name)}</a>` : '<a class="prev" href="./" rel="prev" aria-disabled="true"><span>Previous</span>The first pattern</a>'}
    ${next ? `<a class="next" href="${next.id}.html" rel="next"><span>Next</span>${esc(next.name)}</a>` : '<a class="next" href="./" rel="next" aria-disabled="true"><span>Next</span>The last pattern</a>'}
  </nav>`;
}

function patternPage(p, i) {
  const g = groupOf(p), main = p.variants[0], others = p.variants.slice(1);
  const pic = pictureOf(p, main);
  const li = (a) => a.map((x) => `<li>${x}</li>`).join('\n      ');
  const gen = main.gen ? ', written by the generators for these values and this cell size' : typeof main.code === 'function' ? ', written for these values' : '';
  const start = main.start ? ` The pointer starts on ${esc(String(pic.labels[pic.start] === undefined ? 'cell ' + pic.start : '“' + pic.labels[pic.start] + '” (cell ' + pic.start + ')'))}.` : '';
  const toc = [['pattern', 'Watch it run'], ['code', 'The code'], ['cost', 'What it costs']];
  if (others.length) toc.push(['variations', 'Other forms']);
  toc.push(['used', 'Where it is used'], ['sources', 'Sources']);
  const costRows = p.variants.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.cost ? esc(v.cost.plain[0]) : ''}</td><td>${v.cost ? esc(v.cost.fast[0]) : ''}</td></tr>`).join('\n');
  const body = `  <header class="plain">
    <p class="kicker crumbs"><a href="./">Code patterns</a><a href="./#${g.id}">${esc(g.name)}</a><span>${esc(p.name)}</span></p>
    <h1>${esc(p.name)}</h1>
    <p class="lead">${p.does}</p>
    ${contents(toc)}
  </header>

  ${lessonStrip(i, false)}

  <section id="pattern" aria-labelledby="pattern-h">
    <h2 id="pattern-h">Watch it run</h2>
    <p>${introOf(main, pic)}</p>

    ${figureOf(p, main)}

    ${p.why.map((t) => `<p>${t}</p>`).join('\n    ')}
  </section>

  <section id="code" aria-labelledby="code-h">
    <h2 id="code-h">The code</h2>
    <p>This is the program the figure ran${gen}.${start} It is brainfuck as it stands: copy it, or open it in the playground, where you can change it:</p>

    ${codeOf(p, main, pic)}

    <h3 id="needs">What it needs</h3>
    <ul>
      ${li(p.needs)}
    </ul>

    <details class="q fold" id="mistakes"><summary>Common mistakes</summary><div class="a">
      <ul>
        ${li(p.mistakes)}
      </ul>
      ${p.pitfallText ? `<div class="callout warn" id="wrong"><h3>Wrong as often given</h3><p>${p.pitfallText}</p><p>Each wrong form is run, and it fails in exactly this way.</p></div>` : ''}
    </div></details>
  </section>

  <section id="cost" aria-labelledby="cost-h">
    <h2 id="cost-h">What it costs</h2>
    <p>A <b>plain step</b> is one command. An <b>optimised step</b> is one step of an interpreter that folds runs of the same command and flat loops. Choose the values and watch the two bars; <a href="cost.html">What costs what</a> explains how cost is counted:</p>

    <figure class="fig col" id="fig-${p.id}-${main.id}-cost" data-p="${p.id}" data-v="${main.id}" data-cost-fig aria-label="Steps taken by the form ${esc(main.name)}, for the values you choose">
      <p class="measured">The figure needs JavaScript. The table below has the measured steps.</p>
    </figure>

    <details class="q fold" id="cost-numbers"><summary>Cost as a formula, and measured</summary><div class="a">
      <div class="scroll" tabindex="0" role="region" aria-label="Cost as a formula"><table id="t-formula">
        <caption><b>Table 1.</b> The cost as a function of the values.${p.variants.some((v) => v.cost && (v.cost.plain[1] || v.cost.fast[1])) ? ' Exact formulas are checked on every case they run.' : ''}</caption>
        <thead><tr><th>Form</th><th>Plain steps</th><th>Optimised steps</th></tr></thead>
        <tbody>${costRows}</tbody></table></div>
      <div class="scroll" tabindex="0" role="region" aria-label="Measured cost"><table id="t-measured">
        <caption><b>Table 2.</b> Measured when this page was written.</caption>
        <thead><tr><th>Form</th><th>Values</th><th class="n">Bits</th><th class="n">Characters</th><th class="n">Plain steps</th><th class="n">Optimised steps</th></tr></thead>
        <tbody>${measuredRows(p)}</tbody></table></div>
    </div></details>
    ${compareBlock(p)}
  </section>
${others.length ? `
  <section id="variations" aria-labelledby="variations-h">
    <h2 id="variations-h">Other forms</h2>
    ${others.map((v) => {
      const vp = pictureOf(p, v);
      return `<section class="variation" id="v-${v.id}" aria-labelledby="v-${v.id}-h">
      <h3 id="v-${v.id}-h">${v.baseline ? '<span class="badge">to measure against</span> ' : ''}${esc(v.name)}</h3>
      <p>${v.does}</p>
      ${codeOf(p, v, vp)}
      <details class="q fold" id="run-${v.id}"><summary>Run this form step by step</summary><div class="a">
        <p>${introOf(v, vp)}</p>
        ${figureOf(p, v)}
      </div></details>
    </section>`;
    }).join('\n    ')}
  </section>
` : ''}
  <section id="used" aria-labelledby="used-h">
    <h2 id="used-h">Where it is used</h2>
    <ul>
      ${li(p.used)}
    </ul>
  </section>

  <section id="sources" aria-labelledby="sources-h">
    <h2 id="sources-h">Sources</h2>
    <ul>
      ${p.sources.map((s) => `<li>Source: <a href="${esc(s.url)}">${esc(s.name)}</a>${s.note ? ': ' + s.note + '.' : '.'}</li>`).join('\n      ')}
    </ul>
    <p class="measured">Every program on this page was run on many inputs, in plain and in optimised mode, and compared with JavaScript. The explanations are written for this page.</p>
  </section>

  ${lessonStrip(i, true)}`;
  return page({ title: p.name, desc: plain(p.does) + ' A brainfuck code pattern you can run, step through and copy.', body, cls: 'pattern-page' });
}

function glance(p) {
  const v = p.variants[0], code = core.program(v, core.defaults(v), bitsOf(v), G).code;
  return code.length > 64 ? esc(code.slice(0, 60)) + '<span class="muted">… ' + fmt(code.length) + ' characters</span>' : esc(code);
}

function mini(p) {
  const v = p.variants[0], bits = bitsOf(v), pic = core.picture(v, core.defaults(v), bits, G);
  const half = 2 ** (bits - 1), val = (x) => fmt(pic.signed && x >= half ? x - 2 * half : x);
  const live = (a) => a >= 0 && (pic.before[a] !== 0 || pic.after[a] !== 0 || a === pic.start || a === pic.end || pic.read.has(a) || pic.changed.has(a));
  const first = Math.max(0, pic.items.findIndex(live));
  const cols = [], said = { b: [], a: [] };
  let room = 30, cut = first > 0;
  for (const a of pic.items.slice(first)) {
    if (a < 0) { if (room < 3) { cut = true; break; } cols.push(null); room -= 2; continue; }
    const b = val(pic.before[a]), z = val(pic.after[a]), w = Math.max(b.length, z.length) + 1.6;
    if (w > room && cols.length) { cut = true; break; }
    room -= w;
    cols.push([b, z, (pic.read.has(a) ? ' rd' : '') + (a === pic.start ? ' here' : ''), (pic.changed.has(a) ? ' ch' : '') + (a === pic.end ? ' here' : ''), Math.max(b.length, z.length)]);
    const name = pic.labels[a] === undefined ? 'cell ' + a : pic.labels[a];
    said.b.push(name + ' ' + b + (a === pic.start ? ' (pointer)' : ''));
    said.a.push(name + ' ' + z + (a === pic.end ? ' (pointer)' : ''));
  }
  const r = pic.r, io = [];
  if (r.input.length) io.push('reads ' + V.shown(r.input.map((c) => String.fromCharCode(c)).join('')));
  if (r.out.length) io.push('prints ' + V.shown(r.out));
  const label = 'Tape before: ' + said.b.join(', ') + '. After: ' + said.a.join(', ') + '.' + (cut ? ' More cells are on the page of the pattern.' : '') + (io.length ? ' It ' + io.join(' and ') + '.' : '');
  const row = (k) => '<span class="tape joined">' + cols.map((c) => (c ? '<span class="cell' + c[k + 2] + '"' + (c[4] > 1 ? ' style="min-width:calc(' + c[4] + 'ch + 12px)"' : '') + '><b>' + esc(c[k]) + '</b></span>' : '<span class="mt-g muted">…</span>')).join('') + (cut ? '<span class="mt-g muted">…</span>' : '') + '</span>';
  return '<span class="mt" role="img" aria-label="' + esc(label) + '"><span class="mt-r"><span class="mt-k muted small">before</span>' + row(0) + '</span><span class="mt-r"><span class="mt-k muted small">after</span>' + row(1) + '</span>'
    + (io.length ? '<span class="mt-io muted small">' + esc(io.join(', ')) + '</span>' : '') + '</span>';
}

function indexPage() {
  const copy = data.byId.copy, cv = copy.variants[0], cpic = pictureOf(copy, cv);
  const groups = data.GROUPS.map((g) => {
    const members = data.PATTERNS.filter((p) => p.group === g.id);
    return `<section class="grp" id="${g.id}" data-group>
    <h2><span class="label">${esc(g.want)}</span> ${esc(g.name)}</h2>
    <ul class="linklist plist">
      ${members.map((p) => `<li data-k="${esc((p.name + ' ' + plain(p.does) + ' ' + (p.key || '') + ' ' + p.variants.map((v) => v.name).join(' ')).toLowerCase())}"><a href="${p.id}.html"><b>${esc(p.name)}</b><span>${plain(p.does)}</span><code class="bf">${glance(p)}</code>${mini(p)}</a></li>`).join('\n      ')}
    </ul>
  </section>`;
  }).join('\n\n  ');
  const nv = data.PATTERNS.reduce((a, p) => a + p.variants.length, 0);
  const body = `  <header class="plain">
    <p class="kicker crumbs"><a href="../playground/">Play</a><span>Code patterns</span></p>
    <h1>Code patterns</h1>
    <p class="lead">Short pieces of brainfuck that each do one job: move a number, copy it, decide, calculate, print. Run each one, step through it, change its values, copy it.</p>
    ${contents([['example', 'One pattern at work'], ['find', 'Find a pattern'], ['next', 'Where to go next']])}
  </header>

  <section id="example" aria-labelledby="example-h">
    <h2 id="example-h">One pattern at work</h2>
    <p>The program below copies the number in the first cell into the second cell and keeps it in the first. Press <em>Play</em>, drag the step slider forwards and back, or change x:</p>

    <figure class="fig col" id="fig-intro" data-p="copy" data-v="right" aria-label="A program that copies the first of three cells into the second">
      <p class="measured">The figure needs JavaScript.</p>
    </figure>

    <p>Notice that the number never travelled in one piece. The first loop emptied x and gave each unit to two cells at once, the copy and the third cell. The second loop poured the third cell back into x. A cell can only be read by emptying it, so a copy needs a helper that starts and ends at 0. A helper like that is a <b>scratch cell</b>.</p>
    <p>This program is a <b>code pattern</b>: a short piece of brainfuck that does one job, written so that every cell starts and ends in a known state. Every pattern here has a figure like this one, the program to copy, what it costs, and other forms of the same job. The marks you saw are the same everywhere: the pointer is the cell with the heavy edge and the triangle, and a cell in bold has just changed.</p>

    <details class="q fold" id="words"><summary>Words used on the pattern pages</summary><div class="a">
      <dl class="glossary">
        <dt>Pointer</dt><dd>The cell the program is working on. A pattern says where it must start and where it ends.</dd>
        <dt>Read, changed, put back</dt><dd>In the small drawings below: “read” means the program looks at the cell, “changed” means it holds a new value at the end, and “put back” means it was used on the way and holds its old value again.</dd>
        <dt>Scratch cell</dt><dd>A helper cell. It must be zero before the pattern runs, and the pattern leaves it zero. The tests check both.</dd>
        <dt>Cost</dt><dd>How many steps the pattern takes. A <b>plain step</b> is one command. An <b>optimised step</b> is counted by an interpreter that folds simple loops. The two can differ a thousand times; <a href="cost.html">What costs what</a> shows why.</dd>
        <dt>Cell size</dt><dd>Most patterns work on any cell size. Where a pattern needs cells that wrap round, or a fixed width of 8, 16 or 32 bits, its page says so under “What it needs”.</dd>
      </dl>
    </div></details>

    <p class="next-q">${data.PATTERNS.length} patterns follow, ${nv} forms in all. Which job do you need?</p>
  </section>

  <section id="find" aria-labelledby="find-h">
    <h2 id="find-h">Find a pattern</h2>
    <div class="finder">
      <label class="stacked" for="q">Search by what it does
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="copy, divide, if, print …"></label>
      <p class="measured" id="q-said" role="status">${data.PATTERNS.length} patterns, ${nv} forms. Every one is tested.</p>
    </div>
    <p>Under each pattern is the tape before and after its first form, for the values in its figure.</p>
    <ul class="legend" aria-label="The marks in the small drawings"><li><i class="sw here"></i>the pointer is on this cell</li><li><i class="sw rd"></i>the program reads this cell</li><li><i class="sw ch"></i>the cell holds a new value</li></ul>

    ${groups}
  </section>

  <section id="next" aria-labelledby="next-h">
    <h2 id="next-h">Where to go next</h2>
    <ul>
      <li><a href="../brainfuck/">Start here</a> teaches the language from the eight commands; the <a href="../challenges/basics/">Brainfuck basics</a> are ten short lessons, and <a href="../learn/">Build toward a chatbot</a> builds the advanced patterns on this page.</li>
      <li><a href="../playground/">The playground</a> is a blank page to run your own program, and <a href="../challenges/">the challenges</a> check your answers.</li>
      <li><a href="../reference/">The reference</a> defines the words, and <a href="../how/">How it works</a> follows one question through a chat model written with the advanced patterns.</li>
    </ul>
  </section>`;
  return page({ title: 'Code patterns', desc: 'A library of brainfuck patterns: move, copy, if and else, compare, multiply, divide, arrays, strings, printing numbers, and the fast patterns of the chat models. Each one runs in the page and is tested.', body, cls: 'pattern-index' });
}

function costPage() {
  const len = (id, vid, vals) => { const v = data.byId[id].variants.find((x) => x.id === vid); return core.program(v, Object.assign(core.defaults(v), vals || {}), bitsOf(v), G).code.length; };
  const sizeRows = [
    ['The number 200', 'one plus per unit', len('constant', 'plain', { n: 200 }), 'a product and a rest', len('constant', 'product', { n: 200 })],
    ['“Hello, World!”', 'every letter from zero', len('print-string', 'zero'), 'a few seeded cells', len('print-string', 'seeded')],
    ['Twelve numbers of 262', 'one plus per unit', len('digit-planes', 'plain', { a: Array(12).fill(262) }), 'as digits', len('digit-planes', 'planes', { a: Array(12).fill(262) })],
    ['One job in 64 frames', 'written out 64 times', len('frames', 'unrolled', { n: 64 }), 'one copy, walked', len('frames', 'loop', { n: 64 })],
  ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="n">${fmt(r[2])}</td><td>${r[3]}</td><td class="n">${fmt(r[4])}</td></tr>`).join('\n');
  const body = `  <header class="plain">
    <p class="kicker crumbs"><a href="./">Code patterns</a><span>What costs what</span></p>
    <h1>What costs what</h1>
    <p class="lead">Why some things are nearly free in brainfuck and others take millions of steps.</p>
    ${contents([['one-question', 'One question'], ['folding', 'What folds'], ['measure', 'Cheap and expensive'], ['not-folded', 'What cannot be folded'], ['bits', 'Bits, not units'], ['length', 'Length'], ['rules', 'Rules of thumb']])}
  </header>

  <section id="one-question" aria-labelledby="one-question-h">
    <h2 id="one-question-h">One question</h2>
    <p>The program below empties a cell that holds 5. Press <em>Play</em> and count how often it asks “is this cell zero?”. Then open <em>More controls</em>, choose “flat loops as one step”, and count again:</p>

    <figure class="fig col" id="fig-one-question" data-p="clear" data-v="minus" aria-label="The program that empties a cell, run one command at a time">
      <p class="measured">The figure needs JavaScript.</p>
    </figure>

    <p>Brainfuck has one way to look at a cell: a bracket asks “is this cell zero?”. It cannot ask “is it 5?” or “is it more than that one?”. So a program finds out how large a number is by counting it down to zero, and that takes time for every unit. Emptying a cell that holds 200 is 401 commands.</p>
    <p class="next-q">An interpreter that is allowed to look at the whole program first can skip some of that counting. Which loops can it skip?</p>
  </section>

  <section id="folding" aria-labelledby="folding-h">
    <h2 id="folding-h">What an optimising interpreter folds</h2>
    <p>Type a piece of brainfuck below and see what an optimising interpreter makes of it. The list has one line for each step it takes. Try <code class="bf">[-&gt;+&lt;]</code>, then <code class="bf">[-&gt;+&lt;.]</code>, then <code class="bf">[&gt;]</code>, then <code class="bf">[+]</code>:</p>

    <figure class="fig col" id="f-flat" aria-label="How the optimising interpreter reads a piece of program">
      <div data-cost="flat">
        <label class="stacked" for="flat-in">A piece of brainfuck
        <input id="flat-in" type="text" value="[-&gt;+++&lt;]&gt;[-&lt;+&gt;]&lt;" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
        <div id="flat-out" role="status"><p class="measured">This figure needs JavaScript.</p></div>
      </div>
    </figure>

    <p>A fast interpreter reads the program first and replaces three things by one step each:</p>
    <ul>
      <li>A run of the same command. <code class="bf">+++++</code> is “add 5”.</li>
      <li>A move followed by something. <code class="bf">&gt;&gt;&gt;+</code> is “add 1 three cells to the right”.</li>
      <li>A <b>flat loop</b>: a loop that only adds and moves, comes back to where it started, and takes exactly 1 off its own cell each round. <code class="bf">[-&gt;+++&lt;]</code> is “add 3 times this cell to the next one, and empty this cell”. One multiplication.</li>
    </ul>
    <p>That is all. A flat loop costs one step whether its cell holds 2 or 2 billion. Every other loop still goes round, once per unit.</p>
    <p>Look at <code class="bf">[+]</code> in the list. It empties a wrapping cell just as <code class="bf">[-]</code> does, but this interpreter does not fold it: its rule asks for “takes 1 off”. Other interpreters know other tricks. A pattern that needs a certain trick to be fast says so on its page.</p>
    <p class="next-q">Which of the patterns are flat, and which are not?</p>
  </section>

  <section id="measure" aria-labelledby="measure-h">
    <h2 id="measure-h">Cheap and expensive, measured</h2>
    <p>Eight patterns run below on 8-bit cells, for the x and y you choose. The ink bar counts plain steps and the hatched bar counts optimised steps; each row has its own scale. Move the sliders and watch which hatched bars stay still and which grow:</p>

    <figure class="fig col" id="f-table" aria-label="Steps for eight patterns, for the x and y you choose">
      <div data-cost="table">
        <div class="ctl vals" id="ct-ctl"></div>
        <div id="ct-out" role="status"><p class="measured">This figure needs JavaScript.</p></div>
      </div>
      <p class="measured">Run in your browser, on 8-bit cells. <span class="ev">measured</span></p>
    </figure>

    <p>The first four rows are flat loops. Their optimised cost does not move. The last four hold a loop inside a loop, or a decision inside a loop. No interpreter can fold those without understanding what the program means, so their cost grows with the numbers.</p>
  </section>

  <section id="not-folded" aria-labelledby="not-folded-h">
    <h2 id="not-folded-h">What cannot be folded</h2>
    <ul>
      <li><b>A loop with a loop inside.</b> <a href="mul-cells.html">Multiplying two cells</a> is “add y, x times”. The inner loop is one step; the outer one goes round x times.</li>
      <li><b>A loop with a decision inside.</b> <a href="compare-less.html">Less than</a>, <a href="satsub.html">saturating subtract</a> and <a href="divmod.html">divide, with remainder</a> look at a cell every round.</li>
      <li><b>A loop that does not come back.</b> A scan (<a href="scan.html">find a zero cell or a marker</a>) such as <code class="bf">[&gt;]</code> ends on another cell than it started on. It costs one step per cell it passes.</li>
      <li><b>A loop that reads or prints.</b> The outside world wants every letter one at a time.</li>
    </ul>
    <p>All of these count in units: one round for every 1 in the number. That is fine for a letter code. It is hopeless for the sums of a chat model, which run into millions.</p>
    <p class="next-q">Is there a way to count something smaller than units?</p>
  </section>

  <section id="bits" aria-labelledby="bits-h">
    <h2 id="bits-h">The way out: count bits, not units</h2>
    <p>Below, X is divided by 128 and rounded in two ways on 32-bit cells: by counting down in units, and by the pattern <a href="shift-round-clamp.html">shift, round and clamp</a>. Both are run in your browser. Drag X and compare the two bars, then make X ten times larger:</p>

    <figure class="fig col" id="f-bits" aria-label="X divided by 128 by counting and by peeling bits, in optimised steps">
      <div data-cost="bits">
        <div class="ctl vals" id="cb-ctl"></div>
        <div id="cb-out" role="status"><p class="measured">This figure needs JavaScript and the files emit.js and patterns.js.</p></div>
      </div>
      <p class="measured">Optimised steps, run in your browser. <span class="ev">measured</span></p>
    </figure>

    <p>A number below a million has a million units but only 20 bits. A program that can read a number bit by bit needs 20 rounds instead of a million.</p>
    <p>On cells that wrap at a known width it can. Multiplying by 2 is a flat loop, and it pushes the top bit out of the cell. That turns “is this bit set?” into “is this cell zero?”: the <a href="bit-peel.html">bit peel</a>.</p>
    <p>This one idea carries the chat models of this site. Their division, their multiplication of two numbers from the tape and their table lookups are all “peel some bits, and do something for each set bit”: see the group <a href="./#advanced">Advanced: wrapping cells of a known width</a> on the front page of the patterns, and <a href="../how/">How it works</a>.</p>
    <p>It has a price. The program text is made for one cell width and is wrong on any other. And it is only fast on an interpreter that folds flat loops: counted in plain steps the shifts are long loops.</p>
  </section>

  <section id="length" aria-labelledby="length-h">
    <h2 id="length-h">Length is a cost too</h2>
    <p>A brainfuck program is a text. Every constant in it is written out, and a long text takes long to load and to read in. Several patterns exist only to make the text shorter. The table gives the length of the same result written two ways, for four jobs:</p>
    <div class="scroll" tabindex="0" role="region" aria-label="Lengths of program texts"><table id="t-length">
      <caption><b>Table 1.</b> The same result, two texts. Lengths in characters, measured when this page was written.</caption>
      <thead><tr><th>What</th><th>Long form</th><th class="n">Characters</th><th>Short form</th><th class="n">Characters</th></tr></thead>
      <tbody>${sizeRows}</tbody></table></div>
    <p>The four rows are these patterns: <a href="constant.html">set a constant</a>, <a href="print-string.html">print a constant string</a>, <a href="digit-planes.html">write many numbers compactly as digits</a> and <a href="frames.html">one copy of code over many frames</a>.</p>
  </section>

  <section id="rules" aria-labelledby="rules-h">
    <h2 id="rules-h">Rules of thumb</h2>
    <ul>
      <li>Moving, copying, adding, subtracting and multiplying by a constant are flat. Use them freely.</li>
      <li>Anything that must look at a value on the way (compare, divide, stop at zero) costs a round per unit. Keep those numbers small, or put the smaller number in the loop.</li>
      <li>A walk costs a step per cell. Keep things that work together next to each other.</li>
      <li>When the numbers get large and the cells wrap at a known width, switch from units to bits.</li>
      <li>Say what you count. “Fast” on an optimising interpreter and “fast” in plain steps are different claims.</li>
    </ul>
  </section>

  <nav class="lesson end" aria-label="Pages of the code patterns">
    <p class="course">Code patterns</p>
    <p class="count">What costs what</p>
    <a class="prev" href="./" rel="prev"><span>Back to</span>All patterns</a>
    <a class="next" href="bit-peel.html" rel="next"><span>Next</span>The bit peel</a>
  </nav>`;
  return page({ title: 'What costs what', desc: 'Why some things are cheap and expensive in brainfuck: the only test is "is this cell zero?". What an optimising interpreter folds and what it cannot, with live counters.', body, cls: 'pattern-cost' });
}

const files = { 'index.html': indexPage(), 'cost.html': costPage() };
data.PATTERNS.forEach((p, i) => { files[p.id + '.html'] = patternPage(p, i); });
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(PAGES, name), html);
console.log('wrote ' + Object.keys(files).length + ' pages to site/patterns/');
