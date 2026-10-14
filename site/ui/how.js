// The figures of "How it works" (how/index.html).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A = window.Article, fmt = A.fmt, minus = A.minus, el = A.el, glyph = A.glyph, drawTape = A.drawTape, slider = A.slider, scrubber = A.scrubber, runner = A.runner;

  var figs = {};

  // ---- 1. letters go in as numbers ----------------------------------------------------
  figs['fig-read'] = function () {
    var Q = 'What is the capital of France?', N = 9;
    var tape, p, at;
    var pos = slider('The letter that , reads next', 1, Q.length, 1, function (v) { return at >= Q.length ? 'none left' : v + ': ' + glyph(Q[v - 1]); });
    $('r-ctl').prepend(pos.label);
    function draw(text) {
      $('r-text').replaceChildren.apply($('r-text'), Array.from(Q, function (ch, i) { return el('span', i === at ? 'now' : '', ch); }));
      drawTape($('r-tape'), tape, p, { pick: function (i) { p = i; draw('The pointer is on cell ' + i + ', which holds ' + tape[i] + '.'); } });
      pos.input.value = Math.min(at + 1, Q.length); pos.show();
      $('r-said').textContent = text;
    }
    function press(c) {
      var m = new LearnCore.Machine(c, { bits: 8, size: N, init: tape, input: at < Q.length ? [Q.charCodeAt(at)] : [] });
      m.p = p; m.step();
      if (m.error) return draw('The row ends here. Move the other way.');
      tape = m.tape; p = m.p;
      if (c !== ',') return draw('Moved one cell to the ' + (c === '>' ? 'right' : 'left') + '. The pointer is on cell ' + p + ', which holds ' + tape[p] + '.');
      if (at >= Q.length) return draw('The question has no letters left, so , put 0 in cell ' + p + '.');
      at++;
      draw('Read “' + glyph(Q[at - 1]) + '”. Its number, ' + tape[p] + ', is now in cell ' + p + '.');
    }
    function reset() { tape = new Uint8Array(N); p = 0; at = 0; draw('Press , and watch the first box.'); }
    Array.prototype.forEach.call($('r-keys').children, function (b) { b.addEventListener('click', function () { press(b.dataset.c); }); });
    pos.input.addEventListener('input', function () { at = Number(pos.input.value) - 1; draw('The next , will read “' + glyph(Q[at]) + '”.'); });
    $('r-reset').addEventListener('click', reset);
    reset();
  };

  // ---- 2. word pieces (the pieces and numbers of this question in brnfck-135m) ----
  figs['fig-pieces'] = function () {
    var PIECES = [['What', 1780], [' is', 314], [' the', 260], [' capital', 3575], [' of', 282], [' France', 4649], ['?', 47]];
    var letters = [], chips = [];
    function show(n) {
      letters.forEach(function (c) { c.classList.toggle('here', Number(c.dataset.p) === n); });
      chips.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === n)); });
      var text = PIECES[n][0];
      $('p-said').textContent = '“' + text.replace(' ', '␣') + '” is word piece number ' + fmt(PIECES[n][1]) + ': ' + text.length + (text.length === 1 ? ' character' : ' characters') + (text[0] === ' ' ? ', the space in front included' : '') + ', one word piece.';
    }
    PIECES.forEach(function (piece, n) {
      Array.from(piece[0]).forEach(function (ch) {
        var c = el('div', 'cell pick'); c.append(el('b', '', glyph(ch))); c.dataset.p = n;
        c.addEventListener('click', function () { show(n); });
        letters.push(c); $('p-letters').append(c);
      });
      var b = el('button', '', piece[0].replace(' ', '␣')); b.type = 'button';
      b.addEventListener('click', function () { show(n); });
      chips.push(b); $('p-chips').append(b);
    });
    show(3);
  };

  // ---- 3a. walking to a row
  figs['fig-lookup'] = function () {
    var NAMES = ['What', 'capital', 'France'], ROWS = { 1: 7, 2: 1, 4: 3, 5: 8, 7: 2, 8: 5 };
    runner($('fig-lookup'), {
      rate: 6,
      values: [{ name: 'Word piece to fetch', min: 0, max: 2, value: 2, say: function (v) { return v + ': “' + NAMES[v] + '”'; } }],
      build: function (v) {
        var k = v[0], init = Object.assign({ 0: k }, ROWS);
        return {
          code: '[[->>>+<<<]>>>-]', init: init, cells: 9,
          groups: NAMES.map(function (n, i) { return i + ': “' + n + '”'; }),
          mark: function (m, c) { return m.done && (c === m.p + 1 || c === m.p + 2); },
          end: function (m) { return 'Finished. The pointer stands on cell ' + m.p + '. The two cells to its right, ' + m.tape[m.p + 1] + ' and ' + m.tape[m.p + 2] + ', are the row of “' + NAMES[k] + '”.'; }
        };
      }
    });
  };

  // ---- 3b. multiply and add: three loops, one total --------------------------------------
  figs['fig-sum'] = function () {
    var X = [2, 1, 3];
    var w = function (i, start) { return { name: 'Weight for the ' + X[i], min: 0, max: 5, value: start, say: function (v) { return '× ' + v; } }; };
    runner($('fig-sum'), {
      rate: 12,
      values: [w(0, 3), w(1, 2), w(2, 1)],
      build: function (W) {
        var code = X.map(function (x, i) { var d = 3 - i; return '[-' + '>'.repeat(d) + '+'.repeat(W[i]) + '<'.repeat(d) + ']'; }).join('>');
        return {
          code: code, init: X.concat([0]), cells: 4, at: 'end',
          top: function (i) { return i < 3 ? 'number' : 'total'; },
          mark: function (m, c) { return c === 3; },
          end: function (m) { return 'Finished. ' + X.map(function (x, i) { return x + ' × ' + W[i]; }).join(' + ') + ' = ' + m.tape[3] + '. Drag Step to the left to see the total being made.'; }
        };
      }
    });
  };

  // ---- 4. looking back: scores become shares ------------------------------------------------
  function rows(box, list, o) {
    var parts = list.map(function (item) {
      var row = el('div', 'srow'), s = slider(item[0], o.min, o.max, item[1], String), end = el('b', 'end'), bar = null;
      row.append(s.label);
      if (o.bars) { var meter = el('div', 'meter'); bar = el('i'); meter.append(bar); row.append(meter); }
      row.append(end); box.append(row);
      s.input.addEventListener('input', function () { o.draw(parts); });
      return { name: item[0], s: s, bar: bar, end: end, row: row, get v() { return Number(s.input.value); } };
    });
    o.draw(parts);
  }
  figs['fig-attn'] = function () {
    rows($('a-rows'), [['“capital”', 8], ['“of”', 1], ['“France”', 9], ['“?”', 2]], {
      min: 0, max: 10, bars: true,
      draw: function (parts) {
        var sum = parts.reduce(function (a, p) { return a + p.v; }, 0), best = parts[0];
        parts.forEach(function (p) { var share = sum ? p.v / sum : 0; p.end.textContent = Math.round(share * 100) + '%'; p.bar.style.width = (share * 100) + '%'; if (p.v > best.v) best = p; });
        $('a-said').textContent = sum ? 'Taken in most: ' + best.name + ', for ' + best.end.textContent + '.' : 'With every score at zero nothing is taken in.';
      }
    });
  };

  // ---- 5a. the highest score wins
  figs['fig-pick'] = function () {
    rows($('k-rows'), [['“␣Paris”', 17], ['“␣London”', 9], ['“␣France”', 6], ['“␣the”', 4], ['“␣a”', 2]], {
      min: 0, max: 20,
      draw: function (parts) {
        var best = parts[0];
        parts.forEach(function (p) { if (p.v > best.v) best = p; });
        parts.forEach(function (p) { p.end.textContent = p === best ? 'highest' : ''; p.row.classList.toggle('on', p === best); });
        $('k-said').textContent = 'The program takes ' + best.name + ', with a score of ' + best.v + '. When two are equal, the one found first is kept here.';
      }
    });
  };

  // ---- 5b. printing a word piece, letter by letter
  figs['fig-print'] = function () {
    var WORD = ' Paris';
    runner($('fig-print'), {
      rate: 3, printed: true,
      values: [{ name: 'Number in cell 1', min: 65, max: 90, value: 80, say: function (v) { return v + ', the letter ' + String.fromCharCode(v); } }],
      build: function (v) {
        var init = Array.from(WORD, function (ch) { return ch.charCodeAt(0); }); init[1] = v[0];
        return {
          code: '.>.>.>.>.>.', init: init, cells: 6,
          top: function (i) { return glyph(String.fromCharCode(init[i])); },
          end: function (m) { return 'Finished. Six cells, six times the command . and six printed characters: “' + String.fromCharCode.apply(null, m.out) + '”.'; }
        };
      }
    });
  };

  // ---- 5c. the answer, one word piece each round
  figs['fig-rounds'] = function () {
    var OUT = [['The', 504], [' capital', 3575], [' of', 282], [' France', 4649], [' is', 314], [' Paris', 7042], ['.', 30]];
    var sc = scrubber($('g-ctl'), {
      max: OUT.length + 1, name: 'Round', rate: 2,
      show: function (n) {
        $('g-out').textContent = OUT.slice(0, n).map(function (p) { return p[0]; }).join('');
        $('g-said').textContent = n === 0 ? 'Nothing printed yet. The question is on the tape as 37 word pieces.'
          : n > OUT.length ? 'Round 8: the highest score goes to the “end” word piece. Nothing is printed and the program stops.'
            : 'Round ' + n + ': the highest of 49,152 scores goes to “' + OUT[n - 1][0].replace(' ', '␣') + '” (word piece number ' + fmt(OUT[n - 1][1]) + '). It is printed and goes back in, so the tape now holds ' + (37 + n) + ' word pieces.';
      }
    });
    sc.show(0);
  };

  // ---- 6. a loop that multiplies
  figs['fig-loop'] = function () {
    runner($('fig-loop'), {
      rate: 5,
      values: [
        { name: 'Left cell starts at', min: 0, max: 9, value: 3 },
        { name: 'Added to the right cell each round', min: 1, max: 9, value: 4 }
      ],
      build: function (v) {
        return {
          code: '+'.repeat(v[0]) + '[->' + '+'.repeat(v[1]) + '<]', cells: 2,
          top: function (i) { return i ? 'right' : 'left'; },
          end: function (m) { return 'Finished. The left cell is empty and the right cell holds ' + m.tape[1] + ': that is ' + v[0] + ' times ' + v[1] + '.'; }
        };
      }
    });
  };

  figs['fig-speed'] = function () {
    var CODE = '[->++++<]';
    var s = slider('Number in the left cell', 0, 60, 10, function (v) { return fmt(Math.round(Math.pow(10, v / 10))); });
    $('f-ctl').append(s.label);
    function draw() {
      var n = Math.round(Math.pow(10, Number(s.input.value) / 10));                 // 1 to 1,000,000, each step of the slider a little more
      var r = LearnCore.count(CODE, { bits: 32, size: 4, init: { 0: n }, plainMax: 5e7 });
      $('f-s1').textContent = fmt(r.plain.steps) + ' commands';
      $('f-s2').textContent = fmt(r.fast.steps) + (r.fast.steps === 1 ? ' operation' : ' operations');
      $('f-bar1').style.width = Math.max(1, 100 * Math.log10(r.plain.steps) / Math.log10(8e6 + 1)) + '%';
      $('f-bar2').style.width = Math.max(.5, 100 * Math.log10(r.fast.steps) / Math.log10(8e6 + 1)) + '%';
      $('f-said').textContent = 'Both ways were run just now. One command at a time the right cell ends at ' + fmt(r.plain.tape[1]) + '; as one operation it ends at ' + fmt(r.fast.tape[1]) + '.';
    }
    s.input.addEventListener('input', draw);
    draw();
  };

  // ---- 7b. two programs that write the same number
  figs['fig-write'] = function () {
    var s = slider('The number to write', 1, 1023, 93, fmt);
    $('w-ctl').append(s.label);
    function draw() {
      var n = Number(s.input.value), digits = [], plain = '+'.repeat(n);
      for (var v = n; v > 0; v = Math.floor(v / 5)) digits.unshift(v % 5);
      var fives = digits.map(function (d) { return '+'.repeat(d); }).join('[->+++++<]>');
      var a = LearnCore.run(plain, { bits: 16, size: 8 }), b = LearnCore.run(fives, { bits: 16, size: 8 });
      $('w-plain').textContent = n <= 48 ? plain : plain.slice(0, 40) + ' …';
      $('w-fives').textContent = minus(fives);
      $('w-plainN').textContent = fmt(plain.length); $('w-fivesN').textContent = fmt(fives.length);
      $('w-plainV').textContent = fmt(a.tape[a.p]); $('w-fivesV').textContent = fmt(b.tape[b.p]);
      var signs = digits.reduce(function (x, y) { return x + y; }, 0);
      $('w-said').textContent = fmt(n) + ' = ' + digits.map(function (d, i) { return d + ' × ' + fmt(Math.pow(5, digits.length - 1 - i)); }).join(' + ') + '. Of the ' + fmt(fives.length) + ' characters of the second program, ' + fmt(signs) + (signs === 1 ? ' is a plus sign' : ' are plus signs') + ' outside a loop; the rest is the loop that multiplies by five.';
    }
    s.input.addEventListener('input', draw);
    draw();
  };

  // ---- 7c. the three models
  figs['fig-size'] = function () {
    var M = {
      small: ['SmolLM2-135M-Instruct', 'about 135 million', '1,030,902,380 characters', '188,012,789 cells (717 MiB)', 'about 1.5 GB', 'about 9 to 16 s', 'about 0.6 to 1.0 s'],
      '0.5b': ['Qwen2.5-0.5B-Instruct', 'about 494 million', '4,169,659,608 characters', '657,597,114 cells', 'about 4 GB', '33 to 47 s', 'about 2.3 s'],
      '1.5b': ['Qwen2.5-1.5B-Instruct', 'about 1.54 billion', '11,430,468,880 characters', '1,827,870,014 cells (6.81 GiB)', 'about 8 GB', '90 to 169 s', '7 to 12 s']
    };
    var dds = $('z-facts').querySelectorAll('dd'), buttons = $('z-seg').querySelectorAll('button');
    function show(key) {
      M[key].forEach(function (t, i) { dds[i].textContent = t; });
      Array.prototype.forEach.call(buttons, function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === key)); });
    }
    Array.prototype.forEach.call(buttons, function (b) { b.addEventListener('click', function () { show(b.dataset.m); }); });
    show('small');
  };

  Object.keys(figs).forEach(function (id) { if ($(id)) figs[id](); });

  (function () {
    if (!$('c-go')) return;
    var WHERE = { name: 'small', manifestUrl: '../dist/small/manifest.json', metaUrl: '../programs/brnfck-135m.meta.json', fileUrl: '../programs/brnfck-135m.bf' };
    // the one big file is only on a computer that built it: do not offer a link that leads nowhere
    fetch(WHERE.fileUrl, { method: 'HEAD' }).then(function (r) { return r.ok; }, function () { return false; }).then(function (there) {
      if (!there) Array.prototype.forEach.call(document.querySelectorAll('.bf-file'), function (s) { s.textContent = 'the program file (programs/brnfck-135m.bf; it is not at this address: the README of the project says how to make it)'; });
    });
    var out = function (key) { return document.querySelector('#c-table [data-c="' + key + '"]'); };
    var ctl = null;
    $('c-go').addEventListener('click', async function () {
      var src = null, status = $('c-status'), counts = new Float64Array(256), total = 0;
      $('c-go').disabled = true; $('c-stop').disabled = false;
      ctl = { stopped: false, abort: function () { this.stopped = true; if (src) src.cancel(); } };
      try {
        var P = await ProgramStart.find(WHERE), size = P.meta.programBytes, shown = 0;
        src = await ProgramSource.open({ manifest: P.manifest, manifestUrl: P.manifestUrl, fileUrl: P.fileUrl, store: true, fetchOptions: { cache: 'no-store' } });
        for (;;) {
          var part = await src.read();
          if (part.done || ctl.stopped) break;
          for (var i = 0; i < part.value.length; i++) counts[part.value[i]]++;
          total += part.value.length;
          if (total - shown > 2e7) { shown = total; status.textContent = 'Counting... ' + fmt(total / 1e6) + ' of ' + fmt(size / 1e6) + ' million characters' + (src.source === 'chunks' ? ' (' + fmt(src.netBytes / 1e6) + ' MB downloaded)' : ''); }
        }
        if (ctl.stopped) { var e = new Error('stopped'); e.name = 'AbortError'; throw e; }
        if (total !== size) throw new Error('got ' + fmt(total) + ' of ' + fmt(size) + ' characters: the download broke off');
        var other = total;
        Array.from('+-<>[].,').forEach(function (ch) { var n = counts[ch.charCodeAt(0)]; other -= n; out(ch).textContent = fmt(n); });
        out('other').textContent = fmt(other); out('total').textContent = fmt(total);
        status.textContent = (other === 0 ? 'Done: only the eight commands.' : 'Done: found characters that are not commands.') + (src.source === 'chunks' ? ' All ' + fmt(src.checked) + ' pieces were equal to their checksums.' : '');
      } catch (err) {
        status.textContent = err.name === 'AbortError' || (ctl && ctl.stopped) ? 'Stopped after ' + fmt(total / 1e6) + ' million characters.' : String(err.message || err);
      }
      ctl = null; $('c-go').disabled = false; $('c-stop').disabled = true;
    });
    $('c-stop').addEventListener('click', function () { if (ctl) ctl.abort(); });
  })();

  // an address with # that points into a fold: the figures above have their height now
  A.openFromHash();
})();
