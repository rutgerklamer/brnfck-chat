// The eight command keys (#cmds) run a tiny brainfuck machine of their own.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const commands = $('cmds');
  const SHOWN = 9;                                   // cells of the tape on the page
  let tape = new Uint8Array(32), pointer = 0, printed = [], loop = '', depth = 0;
  const names = { '>': 'right', '<': 'left', '+': 'add 1', '-': 'take 1', '[': 'loop', ']': 'repeat', ',': 'read', '.': 'print' };
  const colours = { '>': '--c-gt', '<': '--c-lt', '+': '--c-plus', '-': '--c-minus', '[': '--c-open', ']': '--c-open', ',': '--c-in', '.': '--c-out' };
  const START = $('playText').textContent;
  function select(command) {
    for (const button of commands.children) { if (button.dataset.c === command) button.setAttribute('aria-pressed', 'true'); else button.removeAttribute('aria-pressed'); }
    $('commandPlay').style.setProperty('--cell', `var(${colours[command] || '--c-in'})`);
  }
  let from = 0;
  function draw() {
    if (pointer < from) from = pointer;
    if (pointer >= from + SHOWN) from = pointer - SHOWN + 1;
    from = Math.max(0, Math.min(from, tape.length - SHOWN));
    $('commandTape').replaceChildren(...Array.from(tape.slice(from, from + SHOWN), (value, index) => {
      const cell = document.createElement('div'), box = document.createElement('b'), number = document.createElement('i');
      box.textContent = value;
      number.textContent = from + index;
      number.setAttribute('aria-hidden', 'true');
      cell.append(box, number);
      cell.setAttribute('role', 'listitem');
      cell.setAttribute('aria-label', `Cell ${from + index}: ${value}${from + index === pointer ? ', pointer here' : ''}`);
      cell.className = from + index === pointer ? 'cell here' : 'cell';
      return cell;
    }));
    const text = printed.map(value => value >= 32 && value <= 126 ? String.fromCharCode(value) : `(${value})`).join('');
    $('commandOutput').textContent = text.slice(-6) || '—';
    $('commandOutput').title = text || 'Nothing printed yet';
  }
  function paint(message, command) {
    draw();
    $('playText').textContent = message;
    select(command);
  }
  function execute(code) {
    const value = $('commandInput').value || 'A';
    if (code.includes(',') && /[^\x20-\x7e]/.test(value)) return { message: 'Use a basic letter, number or symbol in the box that , reads.', failed: true };
    const machine = new LearnCore.Machine(code, { bits: 8, size: tape.length, init: tape, input: [value.charCodeAt(0)] });
    machine.p = pointer;
    // User-made loops are bounded so an empty or non-terminating loop cannot freeze the page.
    while (!machine.done && machine.steps < 10000) machine.step();
    tape = machine.tape;
    pointer = machine.p;
    printed.push(...machine.out);
    printed = printed.slice(-32);
    if (machine.error) return { message: `This little tape ends here. Try moving ${machine.error === 'left' ? 'right' : 'left'}.`, failed: true };
    if (!machine.done) return { message: 'Paused after 10,000 steps. This loop keeps repeating; try [-] to empty a cell.', failed: true };
    return { steps: machine.steps, value };
  }
  function press(command) {
    if (command === '[') {
      if (loop.length >= 64) return paint('Keep this little loop to 64 commands. Close it with ].', command);
      loop += '['; depth++;
      return paint(depth === 1 ? 'Loop opened. Press the commands that go inside it, then ] to run it.' : `Nested loop opened. ${depth} brackets still need closing.`, command);
    }
    if (depth) {
      if (command === ']') { loop += ']'; depth--; }
      else {
        if (loop.length >= 64) return paint('Keep this little loop to 64 commands. Close it with ].', command);
        loop += command;
      }
      if (depth) return paint(`Building ${loop} · ${depth === 1 ? 'press ] to run it' : `close ${depth} brackets`}`, command);
      const source = loop; loop = '';
      const result = execute(source);
      return paint(result.message || (result.steps === 1 ? 'The cell is zero, so the loop was skipped.' : `Ran ${source} · cell ${pointer} now holds ${tape[pointer]}.`), command);
    }
    if (command === ']') return paint('Press [ first to begin a loop, then the commands that go inside it.', command);
    const result = execute(command);
    if (result.failed) return paint(result.message, command);
    const value = tape[pointer];
    const message = command === ',' ? `Read “${result.value}” · its number is ${value}. Try + then .` : command === '.' ? (value >= 32 && value <= 126 ? `Printed “${String.fromCharCode(value)}” from ${value}.` : `Printed code ${value} · it has no visible letter.`) : command === '<' || command === '>' ? `Moved ${names[command]} · cell ${pointer} holds ${value}.` : `${command === '+' ? 'Added' : 'Took away'} 1 · cell ${pointer} now holds ${value}.`;
    paint(message, command);
  }
  function reset() {
    tape = new Uint8Array(32); pointer = 0; printed = []; loop = ''; depth = 0; from = 0;
    paint(START, '');
  }
  for (const button of commands.children) button.addEventListener('click', () => press(button.dataset.c));
  $('commandReset').addEventListener('click', reset);
  draw();
})();
