// Every challenge: statement, settings, test cases, hints, links and solutions.
self.BFData = (function () {
  'use strict';

  const GROUPS = [
    { id: 'first', title: 'First steps', note: 'One or two commands at a time. Start here if you have just done the Basics, step 1 of the path.' },
    { id: 'output', title: 'Output', note: 'Printing text: building numbers, counting, loops inside loops.' },
    { id: 'input', title: 'Input', note: 'Reading characters until there are none left.' },
    { id: 'arith', title: 'Arithmetic', note: 'Digits are characters. Turn them into numbers, calculate, and turn them back.' },
    { id: 'text', title: 'Text', note: 'Storing a whole text on the tape and walking over it.' },
    { id: 'logic', title: 'Logic', note: 'Doing one thing or another, with only the question "is this cell zero?".' },
    { id: 'tricky', title: 'Tricky', note: 'Odd rules, other settings, and programs that need a plan before you type.' },
  ];

  const B = 'basics/', P = '../patterns/', R = '../reference/';
  const L = {
    machine: ['Basics 1: the machine', B + '01-machine.html'], moving: ['Basics 2: moving', B + '02-moving.html'],
    letters: ['Basics 3: numbers are letters', B + '03-letters.html'], loops: ['Basics 4: loops', B + '04-loops.html'],
    numbers: ['Basics 5: building numbers', B + '05-numbers.html'], input: ['Basics 6: reading input', B + '06-input.html'],
    copy: ['Basics 7: moving and copying', B + '07-copy.html'], decide: ['Basics 8: making a decision', B + '08-deciding.html'],
    program: ['Basics 9: a small program', B + '09-program.html'], reading: ['Basics 10: reading brainfuck', B + '10-reading.html'],
    patterns: ['Patterns', P], reference: ['Reference', R],
    peel: ['Model lesson 5: the way through, peeling off bits', '../learn/05-peel.html'], zero: ['Model lesson 4: obstacle 1, only one question', '../learn/04-zero.html'],
    multiply: ['Model lesson 3: multiplying by a fixed number', '../learn/03-multiply.html'],
  };

  const rep = (s, n) => new Array(n + 1).join(s);
  const chr = (n) => String.fromCharCode(n);
  // test cases from an oracle:  shown inputs, hidden inputs ([input, note] or input)
  const io = (f, shown, hidden) => shown.map((x) => ({ in: x, out: f(x) })).concat((hidden || []).map((h) => {
    const [x, note] = Array.isArray(h) ? h : [h, ''];
    return { in: x, out: f(x), hidden: true, note };
  }));
  const fixed = (out) => [{ in: '', out }];
  const sol = (name, lines, note) => ({ name, lines, note: note || '' });

  // ---- pieces of brainfuck that several solutions share -----------------------------------
  const PRINT_NUMBER = [
    ['[', 'while there is more to do: this cell is the flag and holds 1'],
    ['>>++++++++++<', 'put 10 two cells to the right and stand on the number'],
    ['[->-[>+>>]>[+[-<+>]>+>>]<<<<<]', 'divide by 10: remainder and quotient land in the next two cells'],
    ['>[-]', 'wipe what is left of the 10'],
    ['>[-<<<+>>>]', 'add the remainder to the flag: this cell is now digit plus 1'],
    ['>[[-<<+>>]<<<+>>>]', 'if the quotient is not zero: move it next to the new flag and set that flag'],
    ['<<<', 'stand on the new flag: one cell further than before'],
    [']', ''],
    ['<[', 'walk back over the digits: the highest one comes first'],
    ['>++++++[<++++++++>-]<-.', 'add 47 so that digit plus 1 becomes its character and print it'],
    ['[-]<', 'wipe it and go to the digit before'],
    [']', ''],
  ];

  const C = [];
  const add = (c) => { C.push(c); };

  add({
    id: 'one-letter', group: 'first', title: 'One letter', level: 1,
    text: 'Print the capital letter `A`. There is no input.',
    tests: fixed('A'),
    hints: ['Every character is a number. Look up the number of A in the chart of Basics 3: numbers are letters (step 1).', 'A is 65. A cell that holds 65 prints A when you give the command `.`', 'Sixty-five `+` and then `.` is a correct answer. A loop makes it much shorter: 8 rounds of 8 is 64.'],
    learn: [L.letters, L.numbers],
    solutions: [
      sol('Eight times eight, plus one', [['++++++++', 'cell 0 counts 8 rounds'], ['[>++++++++<-]', 'each round adds 8 to cell 1'], ['>+', 'cell 1 holds 64 and one more makes 65'], ['.', 'print it as a letter']]),
      sol('Going round', [['----', 'cell 0 holds 252 because a cell goes round below zero'], ['[>+<----]', 'take 4 off each round: 63 rounds add 63 to cell 1'], ['>++.', '63 and 2 is 65']], 'Counting down from 252 in fours takes 63 rounds. That costs far more steps, but fewer commands.'),
    ],
    explain: 'There is no way to write "65" in brainfuck, so you build it. A loop that runs 8 times and adds 8 each time makes 64 in 22 commands. One more plus and a full stop print the letter.',
  });
  add({
    id: 'abc', group: 'first', title: 'A, B, C', level: 1,
    text: 'Print `ABC`. There is no input.',
    tests: fixed('ABC'),
    hints: ['Printing does not change the cell.', 'After printing A the cell still holds 65. How far is B from A?', 'Make 65, then `.+.+.`'],
    learn: [L.letters],
    solutions: [
      sol('Make 65 once', [['++++++++[>++++++++<-]>+', 'cell 1 becomes 65'], ['.', 'print A'], ['+.', 'one more is B'], ['+.', 'one more is C']]),
      sol('Going round', [['----[>+<----]>++', '65 the short way'], ['.+.+.', 'A B C']]),
    ],
    explain: 'The letters of the alphabet have numbers that follow each other. Build the first one, and every next letter costs only a plus and a full stop.',
  });
  add({
    id: 'echo-one', group: 'first', title: 'Say it back', level: 1,
    text: 'Read one character and print it. If more input follows, leave it alone.',
    tests: io((s) => s.slice(0, 1), ['a', 'Z'], [['7', 'a digit is a character too'], [' ', 'a space'], ['ab', 'more input follows: print only the first character']]),
    hints: ['Two commands are enough.', 'The comma reads a character into the cell under the pointer.', '`,.`'],
    learn: [L.input],
    solutions: [sol('Read and print', [[',', 'read one character into cell 0'], ['.', 'print cell 0']])],
    explain: 'The comma puts the number of the next input character in the cell. The full stop prints the cell as a character. Nothing in between, so out comes what went in.',
  });
  add({
    id: 'twice', group: 'first', title: 'Twice', level: 1,
    text: 'Read one character and print it two times.',
    tests: io((s) => s[0] + s[0], ['a', '!'], ['x', '0']),
    hints: ['Printing does not use the cell up.', 'You may print the same cell as often as you like.', '`,..`'],
    learn: [L.input],
    solutions: [sol('Print it again', [[',', 'read'], ['..', 'print the same cell two times']])],
    explain: 'A full stop only looks at the cell. The value stays, so a second full stop prints it again.',
  });
  add({
    id: 'next-letter', group: 'first', title: 'The next letter', level: 1,
    text: 'Read one letter and print the letter that follows it in the alphabet. The input is never `z` or `Z`.',
    tests: io((s) => chr(s.charCodeAt(0) + 1), ['a', 'H'], ['y', 'A', 'm']),
    hints: ['A letter is a number in the cell.', 'The next letter is the next number.', '`,+.`'],
    learn: [L.letters, L.input],
    solutions: [sol('Add one', [[',', 'read a letter'], ['+', 'its number plus one is the next letter'], ['.', 'print']])],
    explain: 'Once a character is in a cell it is just a number, and you can calculate with it.',
  });
  add({
    id: 'swap-two', group: 'first', title: 'Back to front', level: 1,
    text: 'Read two characters and print them in the opposite order.',
    tests: io((s) => s[1] + s[0], ['ab', 'no'], ['xx', '10']),
    hints: ['You need to keep the first character while you read the second.', 'Put them in two different cells.', 'Read into cell 0, move right, read into cell 1, print, move back, print.'],
    learn: [L.moving, L.input],
    solutions: [sol('Two cells', [[',', 'first character in cell 0'], ['>,', 'second character in cell 1'], ['.', 'print the second'], ['<.', 'go back and print the first']])],
    explain: 'One cell holds one character. To keep two, use two cells and choose the order in which you visit them.',
  });

  add({
    id: 'hi', group: 'output', title: 'Hi', level: 2,
    text: 'Print `Hi`. There is no input.',
    tests: fixed('Hi'),
    hints: ['H is 72 and i is 105.', 'One loop can fill two cells at once: add to both inside the loop.', '8 rounds of 9 make 72. 8 rounds of 13 make 104, one short of 105.'],
    learn: [L.numbers],
    solutions: [
      sol('One loop, two cells', [['++++++++', '8 rounds'], ['[>+++++++++>+++++++++++++<<-]', 'each round: 9 to cell 1 and 13 to cell 2'], ['>.', 'cell 1 holds 72: H'], ['>+.', 'cell 2 holds 104 and one more is 105: i']]),
      sol('Going round', [['-[>+>--<<-------]', '255 down in sevens: 73 rounds'], ['>-.', '73 less 1 is 72'], ['>-----.', '73 times 2 down from zero is 110 and 5 less is 105']], 'Found by trying every small loop of this shape. It relies on cells going round at 256.'),
    ],
    explain: 'A loop may add to several cells in every round. Choose a number of rounds that brings both cells close to their letters, then fix each with a few plus or minus signs.',
  });
  add({
    id: 'hello', group: 'output', title: 'Hello, World!', level: 3,
    text: 'Print `Hello, World!` exactly: with the comma, the space and the exclamation mark, and no line break at the end. There is no input.',
    tests: fixed('Hello, World!'),
    hints: ['The numbers: H 72, e 101, l 108, o 111, comma 44, space 32, W 87, r 114, d 100, ! 33.', 'They fall in groups: around 70, around 100, around 30 and around 40. Give each group its own cell.', 'One loop of 10 rounds can add 7, 10, 3 and 4 to four cells. Then walk between the cells and nudge each to the next character.'],
    learn: [L.numbers, L.patterns],
    solutions: [
      sol('Four cells near the letters', [
        ['++++++++++', '10 rounds'], ['[>+++++++>++++++++++>+++>++++<<<<-]', 'cells 1 to 4 become 70 100 30 40'],
        ['>++.', '72 H'], ['>+.', '101 e'], ['+++++++..', '108 l l'], ['+++.', '111 o'], ['>>++++.', 'cell 4: 44 comma'], ['<++.', 'cell 3: 32 space'],
        ['<<+++++++++++++++.', 'cell 1: 87 W'], ['>.', 'cell 2 still holds 111: o'], ['+++.', '114 r'], ['------.', '108 l'], ['--------.', '100 d'], ['>+.', 'cell 3: 33 !'],
      ]),
    ],
    explain: 'The trick is to keep a few cells, each near one group of characters, and to move the pointer to the cell that is closest to the next character. Printing leaves a cell as it is, so the two l are one plus-run and two full stops.',
  });
  add({
    id: 'alphabet', group: 'output', title: 'The alphabet', level: 2,
    text: 'Print the 26 capital letters from `A` to `Z`. There is no input.',
    tests: fixed('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    hints: ['Do not write 26 full stops. Let a loop print and add one.', 'Two cells: one holds the letter, the other counts down from 26.', 'With 65 in cell 1 and 26 in cell 2, standing on cell 2: `[<.+>-]`'],
    learn: [L.loops, L.numbers],
    solutions: [
      sol('A letter and a counter', [['++++++++[>++++++++<-]>+', 'cell 1 holds 65'], ['>++++++++++++++++++++++++++', 'cell 2 holds 26'], ['[<.+>-]', 'print the letter and add one: 26 times']]),
      sol('Both from one loop', [['++++++++[>++++++++>+++<<-]', '8 rounds: 64 in cell 1 and 24 in cell 2'], ['>+>++', '65 and 26'], ['[<.+>-]', 'print and step on']]),
    ],
    explain: 'A counter cell says how often, a second cell holds what is printed. Each round prints, adds one to the letter and takes one from the counter.',
  });
  add({
    id: 'countdown', group: 'output', title: 'Countdown', level: 2,
    text: 'Print the digits `9876543210`. There is no input.',
    tests: fixed('9876543210'),
    hints: ['The character 9 is the number 57, and 0 is 48.', 'Start at 57 and go down by one each round, ten rounds.', '57 in cell 1, 10 in cell 2, then `[<.->-]`'],
    learn: [L.letters, L.loops],
    solutions: [sol('Down from 57', [['+++++++[>++++++++<-]>+', 'cell 1 holds 57: the character 9'], ['>++++++++++', 'cell 2 counts 10 rounds'], ['[<.->-]', 'print the digit and take one off']])],
    explain: 'Digits are characters with the numbers 48 to 57. Counting down in a cell that holds 57 walks through 9, 8, 7 and so on.',
  });
  add({
    id: 'stars', group: 'output', title: 'A row of stars', level: 2,
    text: 'Print twenty stars: `********************`. There is no input.',
    tests: fixed(rep('*', 20)),
    hints: ['The star is character 42.', 'One cell holds 42, another counts 20 rounds.', '6 rounds of 7 make 42. Then a loop of 20 rounds with `<.>-` inside.'],
    learn: [L.loops, L.numbers],
    solutions: [
      sol('A star and a counter', [['++++++[>+++++++<-]', 'cell 1 holds 42'], ['>>++++++++++++++++++++', 'cell 2 holds 20'], ['[<.>-]', 'print the star 20 times']]),
      sol('Both from one loop', [['+++++++[>++++++>+++<<-]', '7 rounds: 42 in cell 1 and 21 in cell 2'], ['>>-', '20'], ['[<.>-]', 'print']]),
    ],
    explain: 'The printed cell never changes here. Only the counter goes down.',
  });
  add({
    id: 'ascii', group: 'output', title: 'Everything you can see', level: 3,
    text: 'Print all 95 characters with the numbers 32 to 126, in order: it starts with a space and `!"#` and ends with `|}~`. There is no input.',
    tests: fixed(Array.from({ length: 95 }, (_, i) => chr(32 + i)).join('')),
    hints: ['This is challenge 9, The alphabet, with other numbers.', 'Start at 32 and print 95 times, adding one each time.', '8 rounds can make 32 (4 each) and 96 (12 each) at once. One less than 96 is 95.'],
    learn: [['Challenge 9: The alphabet', 'play.html?c=alphabet'], L.letters, L.loops],
    solutions: [sol('Start and count from one loop', [['++++++++[>++++>++++++++++++<<-]', '8 rounds: 32 in cell 1 and 96 in cell 2'], ['>>-', '95 rounds'], ['[<.+>-]', 'print and add one']])],
    explain: 'Characters 32 to 126 are the ones you can see (32 is the space). Below 32 and at 127 are control characters such as the line break, number 10.',
  });
  add({
    id: 'triangle', group: 'output', title: 'A triangle', level: 4,
    text: 'Print five lines of stars: one star on the first line, two on the second, up to five. End every line, also the last, with a line break (character 10). There is no input.',
    tests: fixed('*\n**\n***\n****\n*****\n'),
    hints: ['A loop inside a loop: the outer one counts lines, the inner one prints stars.', 'Keep a cell with the length of this line and add one to it for every line. The inner loop uses it up, so make a copy first.', 'Cells: lines left, length, two spare cells for copying, a line break (10) and a star (42). Per line: length plus one, copy it, print that many stars, print the line break.'],
    learn: [L.copy, L.loops, L.patterns],
    solutions: [sol('Copy the length, then use the copy', [
      ['+++++', 'cell 0: 5 lines to go'],
      ['>>>>++++++[>+++++++<-]', 'cell 5 holds 42: the star'],
      ['++++++++++', 'cell 4 holds 10: the line break'],
      ['<<<<', 'back to cell 0'],
      ['[', 'for every line'],
      ['>+', 'cell 1: this line is one star longer'],
      ['[->+>+<<]', 'move the length to cells 2 and 3'],
      ['>[-<+>]', 'and put it back from cell 2'],
      ['>[->>.<<]', 'cell 3 times: print the star'],
      ['>.', 'print the line break'],
      ['<<<<-', 'one line fewer'],
      [']', ''],
    ])],
    explain: 'A loop destroys its counter. To use the length of the line and still have it for the next line, copy it first (Basics 7: moving and copying, step 3), and let the inner loop eat the copy.',
  });

  add({
    id: 'cat', group: 'input', title: 'Copy the input', level: 2,
    text: 'Print the whole input, unchanged. The input can be empty. It never holds the character with number 0.',
    tests: io((s) => s, ['hello', 'a b c'], [['', 'empty input: print nothing'], ['x', 'a single character'], ['line 1\nline 2\n', 'line breaks'], [chr(255) + 'A' + chr(1), 'the largest and the smallest character'], [rep('abcdefghij', 30), '300 characters']]),
    hints: ['When the input has run out, the comma puts 0 in the cell.', 'A loop stops when its cell is 0. So: loop while the last character read is not 0.', 'Read, then loop: print, read again. `,[.,]`'],
    learn: [L.input, L.patterns],
    solutions: [sol('Read, then print and read', [[',', 'read the first character'], ['[', 'as long as it is not 0'], ['.', 'print it'], [',', 'read the next: 0 at the end of the input'], [']', '']])],
    explain: 'This is the heart of nearly every program that reads text: read once before the loop, and read again as the last thing inside it. The end of the input arrives as 0 and ends the loop.',
  });
  add({
    id: 'first-line', group: 'input', title: 'The first line', level: 3,
    text: 'The input is one or more lines, and every line ends with a line break (character 10). Print the first line, without its line break.',
    tests: io((s) => s.slice(0, s.indexOf('\n')), ['hello\nworld\n', 'one line\n'], [['\n', 'an empty first line'], ['a\n\nb\n', 'an empty second line'], ['x\n', 'one character']]),
    hints: ['You have to stop at number 10, but a loop stops at 0.', 'Take 10 off the character. Now a line break is 0.', 'Inside the loop put the 10 back before you print. After reading, take 10 off again.'],
    learn: [L.decide, L.input],
    solutions: [sol('Make the line break zero', [[',----------', 'read and take 10 off: a line break is now 0'], ['[', 'not a line break'], ['++++++++++.', 'put the 10 back and print'], [',----------', 'read the next and take 10 off'], [']', '']])],
    explain: '"Is it equal to 10?" becomes "is it zero after taking 10 off?". That is how every comparison in brainfuck works.',
  });
  add({
    id: 'skip-first', group: 'input', title: 'All but the first', level: 2,
    text: 'Print the input without its first character. The input can be empty.',
    tests: io((s) => s.slice(1), ['hello', 'ab'], [['', 'empty input'], ['x', 'one character: print nothing'], ['  two spaces', 'starts with spaces']]),
    hints: ['Read the first character and do nothing with it.', 'A second comma overwrites the cell.', '`,,[.,]`'],
    learn: [L.input],
    solutions: [sol('Read over it', [[',', 'the first character'], [',', 'overwritten by the second'], ['[.,]', 'copy the rest']])],
    explain: 'Reading into a cell throws away what was there. On an empty input both commas give 0 and the loop never starts.',
  });
  add({
    id: 'every-other', group: 'input', title: 'Every other one', level: 2,
    text: 'Print the first, third, fifth, ... character of the input. `abcdef` becomes `ace`. The input can be empty.',
    tests: io((s) => s.split('').filter((_, i) => i % 2 === 0).join(''), ['abcdef', 'hello'], [['', 'empty input'], ['a', 'one character'], ['ab', 'two characters'], ['1234567', 'an odd number of characters']]),
    hints: ['Take the cat program and read more often than you print.', 'Two commas after one full stop.', '`,[.,,]` Check by hand what happens at the end, for an odd and for an even number of characters.'],
    learn: [L.input],
    solutions: [sol('Print one, read two', [[',', 'read the first'], ['[', 'while there is a character'], ['.', 'print it'], [',', 'read one and forget it'], [',', 'read the next one to print'], [']', '']])],
    explain: 'At the end of the input every further comma gives 0 again, so it does not matter whether the text stops after the first or after the second comma.',
  });
  add({
    id: 'doubled', group: 'input', title: 'Seeing double', level: 2,
    text: 'Print every character of the input two times: `abc` becomes `aabbcc`. The input can be empty.',
    tests: io((s) => s.split('').map((c) => c + c).join(''), ['abc', 'no'], [['', 'empty input'], ['a a', 'spaces count too'], ['x', '']]),
    hints: ['Start from the cat program.', 'Print twice inside the loop.', '`,[..,]`'],
    learn: [L.input],
    solutions: [sol('Two full stops', [[',[', 'read: while there is a character'], ['..', 'print it two times'], [',]', 'read the next']])],
    explain: 'The cat program with one more full stop.',
  });
  add({
    id: 'last-char', group: 'input', title: 'The last one', level: 3,
    text: 'Print only the last character of the input. If the input is empty, print nothing.',
    tests: io((s) => s.slice(-1), ['hello', 'ab'], [['', 'empty input: print nothing at all'], ['x', 'one character'], ['end ', 'the last one is a space']]),
    hints: ['You do not know which one is last until the input has ended. Keep them all.', 'Read each character into the next cell: `[>,]`. When the loop stops you stand one cell past the last character.', 'Start at cell 1, so that there is a zero cell to the left. After the loop step back and print only if the cell is not zero.'],
    learn: [L.input, L.decide, L.patterns],
    solutions: [sol('Store, step back, print if there is something', [['>,', 'leave cell 0 empty and read into cell 1'], ['[>,]', 'each next character one cell further'], ['<', 'back onto the last character: or onto empty cell 0'], ['[.>]', 'if it is not zero: print and step onto the zero to leave']])],
    explain: 'The loop `[>,]` lays the text out on the tape. Cell 0 stays empty on purpose: on an empty input the step back lands there, and the last bracket pair, used as an "if", prints nothing.',
  });
  add({
    id: 'how-long', group: 'input', title: 'How long?', level: 3,
    text: 'The input has at most 9 characters. Print how many there are, as one digit: `hello` gives `5`.',
    tests: io((s) => String(s.length), ['hello', 'ab'], [['', 'empty input gives 0'], ['123456789', 'the longest input'], ['   ', 'three spaces']]),
    hints: ['Count in one cell and read into another.', 'For every character read, add one to the counter. The comma overwrites the reading cell, so you need not clear it.', 'The count is a number, not a character. Add 48 before printing.'],
    learn: [L.input, L.letters, L.copy],
    solutions: [sol('Count, then make it a digit', [['>,', 'read into cell 1'], ['[<+>,]', 'for every character: cell 0 plus one and read the next'], ['++++++[<++++++++>-]', 'cell 1 is zero now: use it for 6 rounds of 8 added to cell 0'], ['<.', 'the count plus 48 is its digit']])],
    explain: 'A number and the digit that shows it differ by 48. Every program that prints a number has to add that 48 somewhere.',
  });

  const d = (n) => String(n);
  add({
    id: 'add-digits', group: 'arith', title: 'Adding', level: 3,
    text: 'Read two digits and print their sum, which is never more than 9: `34` gives `7`.',
    tests: io((s) => d(+s[0] + +s[1]), ['34', '50'], [['00', 'zero plus zero'], ['09', 'the largest sum'], ['90', ''], ['45', '']]),
    hints: ['Adding is moving: pour one cell into the other.', 'The two characters are 48 too high each. Their sum is 96 too high, and the answer needs to be 48 too high.', 'Read both, `[<+>-]` to add, take 48 off, print.'],
    learn: [L.copy, L.letters, L.patterns],
    solutions: [sol('Pour, then take 48 off', [[',>,', 'the digits in cells 0 and 1'], ['[<+>-]', 'pour cell 1 into cell 0'], ['++++++[<-------->-]', '6 rounds of 8 off: one 48 too many is gone'], ['<.', 'print']])],
    explain: 'The character 3 is 51 and the character 4 is 52. Together 103, which is 48 more than 55, the character 7. So after adding, one of the two 48s has to go.',
  });
  add({
    id: 'subtract', group: 'arith', title: 'Taking away', level: 3,
    text: 'Read two digits. The first is never smaller than the second. Print the first minus the second: `83` gives `5`.',
    tests: io((s) => d(+s[0] - +s[1]), ['83', '70'], [['00', ''], ['99', 'equal digits give 0'], ['90', 'the largest answer'], ['54', '']]),
    hints: ['Like adding, but take one off the first for every one in the second.', 'The two 48s cancel out, so afterwards the cell holds the plain number.', '`[<->-]` to subtract, then add 48 and print.'],
    learn: [L.copy, L.letters],
    solutions: [sol('Pour with a minus', [[',>,', 'the digits in cells 0 and 1'], ['[<->-]', 'take cell 1 off cell 0'], ['++++++[<++++++++>-]', 'add 48 to make it a digit again'], ['<.', 'print']])],
    explain: 'Subtracting the characters also subtracts their 48s from each other, so the result is a number between 0 and 9 and needs its 48 back.',
  });
  add({
    id: 'n-stars', group: 'arith', title: 'That many stars', level: 3,
    text: 'Read one digit and print that many stars: `3` gives `***`, and `0` gives nothing.',
    tests: io((s) => rep('*', +s), ['3', '5'], [['0', 'zero stars: print nothing'], ['9', 'the largest digit'], ['1', '']]),
    hints: ['First turn the digit into a number: take 48 off.', 'Then it is a counter for a loop.', 'Put 42 in another cell and print it once per round.'],
    learn: [L.letters, L.loops, L.program],
    solutions: [sol('Digit to counter', [[',', 'the digit in cell 0'], ['>++++++[<-------->-]', 'take 48 off cell 0'], ['++++++[>+++++++<-]', 'cell 2 holds 42: the star'], ['<[>>.<<-]', 'cell 0 times: print the star']])],
    explain: 'A digit that has to count something must lose its 48 first. With 48 still in it, the loop would print 51 stars for a 3.',
  });
  add({
    id: 'count-from', group: 'arith', title: 'Count down from', level: 3,
    text: 'Read one digit and count down from it to 0: `3` gives `3210`.',
    tests: io((s) => { let o = ''; for (let i = +s; i >= 0; i--) o += i; return o; }, ['3', '5'], [['0', 'just 0'], ['9', 'the longest row'], ['1', '']]),
    hints: ['You need the digit twice: as the character to print and as the number of rounds.', 'Copy it (Basics 7: moving and copying, step 3). Take 48 off the copy and add 1: a 3 needs four rounds.', 'Then `[<.->-]` prints and counts down.'],
    learn: [L.copy, L.program],
    solutions: [sol('A character and a counter', [[',', 'the digit in cell 0'], ['[->+>+<<]', 'move it to cells 1 and 2'], ['>>[-<<+>>]', 'and back from cell 2: cell 1 is a copy'], ['++++++[<-------->-]', 'take 48 off the copy'], ['<+', 'one round more than the digit'], ['[<.->-]', 'print the character and count both down']])],
    explain: 'The same value plays two parts. A copy lets one of them stay a character (to print) while the other becomes a number (to count rounds).',
  });
  add({
    id: 'multiply', group: 'arith', title: 'Times', level: 4,
    text: 'Read two digits and print their product, which is never more than 9: `24` gives `8`.',
    tests: io((s) => d(+s[0] * +s[1]), ['24', '33'], [['00', 'zero times zero'], ['09', 'zero times something'], ['90', 'something times zero'], ['19', ''], ['91', ''], ['22', '']]),
    hints: ['Multiplying is adding again and again: add the second number once for every one in the first.', 'Adding the second number uses it up. Copy it each round and put it back.', 'Take 48 off both first. Then: for every one in the first, move the second to the answer and a spare cell, and restore it from the spare.'],
    learn: [L.copy, L.multiply, L.patterns],
    solutions: [sol('Add the second, first times', [
      [',>,', 'the digits in cells 0 and 1'], ['>++++++[<--------<-------->>-]', 'take 48 off both'], ['<<', 'stand on the first'],
      ['[-', 'for every one in the first'], ['>[->+>+<<]', 'move the second to cells 2 and 3'], ['>>[-<<+>>]', 'restore it from cell 3'], ['<<<]', 'back to the first'],
      ['>>>++++++[<++++++++>-]', 'add 48 to the answer in cell 2'], ['<.', 'print'],
    ])],
    explain: 'The outer loop counts the first number down. Each round adds the whole second number to the answer. Because adding empties a cell, the second number is poured into two cells at once and one of them is poured back.',
  });
  add({
    id: 'halve', group: 'arith', title: 'Half', level: 4,
    text: 'Read one digit and print half of it, rounded down: `6` gives `3` and `7` gives `3`.',
    tests: io((s) => d(Math.floor(+s / 2)), ['6', '7'], [['0', ''], ['1', 'half of one, rounded down, is 0'], ['9', 'the largest digit'], ['8', '']]),
    hints: ['Take two off at a time and count how often that works.', 'The danger is the odd one out: after taking one off, check that there is still something before you take the second.', 'Inside the loop: take 1; if the cell is still not zero, take 1 more and add 1 to the answer. An "if" that must end: move the rest of the cell away, and back afterwards.'],
    learn: [L.decide, L.zero, L.patterns],
    solutions: [sol('Two at a time, carefully', [
      [',>++++++[<-------->-]<', 'the number in cell 0'],
      ['[-', 'take one off'],
      ['[', 'if something is left'], ['->+<', 'take one more and count a pair in cell 1'], ['[>>+<<-]', 'park the rest in cell 2 so that this "if" ends'], [']', ''],
      ['>>[<<+>>-]<<', 'bring the rest back'],
      [']', ''],
      ['>>++++++[<++++++++>-]<.', 'add 48 to the count in cell 1 and print'],
    ])],
    explain: 'Brackets repeat as long as the cell is not zero. To make them run only once (an "if"), the cell has to be zero at the closing bracket. Here the rest of the number is parked in a spare cell for that moment.',
  });
  add({
    id: 'print-number', group: 'arith', title: 'Its number', level: 5,
    text: 'Read one character and print its number in ordinary digits: `A` gives `65`. If the input is empty, print `0`.',
    tests: io((s) => d(s.length ? s.charCodeAt(0) : 0), ['A', 'z'], [['', 'empty input: the cell holds 0, print 0'], [chr(255), 'the largest value a cell can hold: 255'], [chr(100), 'a zero at the end: 100'], [chr(10), 'the line break: 10'], [chr(7), 'one digit'], ['e', 'a zero in the middle: 101']]),
    hints: ['The last digit of a number is the remainder after dividing by 10. What is left to print is the number divided by 10.', 'That gives the digits in the wrong order, last one first. Store them on the tape and print them walking back.', 'Dividing by counting: go round the number, and every tenth round add one to the quotient. Search the patterns library for "divmod". Print at least one digit, also when the number is 0.'],
    learn: [L.patterns, L.zero, L.reading],
    solutions: [sol('Peel off digits, print them backwards', [['>+>,<', 'cell 0 stays empty: flag 1 in cell 1: the number in cell 2']].concat(PRINT_NUMBER))],
    explain: 'Each round divides the number by 10. The remainder is the next digit, from the right. It is stored (plus 1, so that a digit 0 is not an empty cell) and the work moves one cell to the right. When nothing is left, the pointer walks back over the stored digits and prints them, highest first. The flag makes sure the first round always happens, so 0 prints as "0".',
  });
  add({
    id: 'read-number', group: 'arith', title: 'From digits to a character', level: 4,
    text: 'The input is a number from 32 to 126, written in digits. Print the character with that number: `65` gives `A`.',
    tests: io((s) => chr(+s), ['65', '104'], [['32', 'the smallest: a space'], ['126', 'the largest'], ['100', 'zeros'], ['99', '']]),
    hints: ['Reading "65" means: 6, then 6 times 10 plus 5.', 'Keep a running total. For every new digit: total times 10, plus the digit.', 'Times 10: move the total to a spare cell, adding 10 for every 1, and move it back.'],
    learn: [L.copy, L.multiply, L.patterns],
    solutions: [sol('Total times ten, plus the digit', [
      ['>,', 'cell 0 is the total: read into cell 1'],
      ['[', 'for every digit'],
      ['>++++++[<-------->-]', 'take 48 off the digit'],
      ['<<[->>++++++++++<<]', 'pour the total into cell 2: ten for every one'],
      ['>>[-<<+>>]', 'and back'],
      ['<[-<+>]', 'add the digit to the total'],
      [',', 'next digit'],
      [']', ''],
      ['<.', 'print the total as a character'],
    ])],
    explain: 'This is how every program reads a number: one digit at a time, multiplying what it has by ten before adding the next digit.',
  });

  add({
    id: 'reverse', group: 'text', title: 'Backwards', level: 3,
    text: 'Print the input backwards: `hello` becomes `olleh`. The input can be empty and never holds the character with number 0.',
    tests: io((s) => s.split('').reverse().join(''), ['hello', 'ab'], [['', 'empty input'], ['x', 'one character'], ['a b', 'with a space'], [rep('0123456789', 20), '200 characters']]),
    hints: ['Store the whole input on the tape first.', '`[>,]` reads every character into the next cell.', 'Leave cell 0 empty. After reading, walk left printing until you meet that empty cell: `<[.<]`'],
    learn: [L.input, L.patterns],
    solutions: [sol('Lay it out, walk back', [['>,[>,]', 'the text in cells 1 2 3 and on: cell 0 stays empty'], ['<', 'onto the last character'], ['[.<]', 'print and step left until the empty cell']])],
    explain: 'An empty cell works as a fence: a loop that walks over cells stops when it reaches one. Leaving cell 0 empty gives the walk back a place to stop.',
  });
  add({
    id: 'upper', group: 'text', title: 'Shout', level: 3,
    text: 'The input is made of small letters `a` to `z` only. Print it in capitals: `hello` becomes `HELLO`. The input can be empty.',
    tests: io((s) => s.toUpperCase(), ['hello', 'abc'], [['', 'empty input'], ['z', 'the last letter'], ['a', 'the first letter'], ['qwertyuiopasdfghjklzxcvbnm', 'every letter']]),
    hints: ['Compare the numbers of a and A in the chart.', 'A capital is always 32 less than its small letter.', 'The cat program, with 32 taken off before printing. Use a spare cell: 4 rounds of 8.'],
    learn: [L.letters, L.input],
    solutions: [
      sol('Take 32 off with a small loop', [[',[', 'for every letter'], ['>++++[<-------->-]', '4 rounds of 8 off cell 0'], ['<.', 'print'], [',]', 'next']]),
    ],
    explain: 'In the character table the capitals start at 65 and the small letters at 97. The distance, 32, is the same for every letter.',
  });
  add({
    id: 'exclaim', group: 'text', title: 'With feeling', level: 2,
    text: 'Print the input followed by an exclamation mark: `hello` becomes `hello!`. On an empty input print only `!`.',
    tests: io((s) => s + '!', ['hello', 'no'], [['', 'empty input: only the !'], ['!', 'the input is one ! already'], ['a b', '']]),
    hints: ['First the cat program.', 'After the loop the cell is 0. Build 33 from there.', '4 rounds of 8 is 32, one more is 33.'],
    learn: [L.input, L.numbers],
    solutions: [sol('Cat, then 33', [[',[.,]', 'copy the input: the cell ends at 0'], ['++++[>++++++++<-]', '4 rounds of 8 into cell 1'], ['>+.', '33 is the exclamation mark']])],
    explain: 'When a loop ends you know something for certain: its cell is zero. That is a clean place to start building the next number.',
  });
  add({
    id: 'twice-all', group: 'text', title: 'Say it again', level: 3,
    text: 'Print the whole input two times in a row: `abc` becomes `abcabc`. The input can be empty and never holds the character with number 0.',
    tests: io((s) => s + s, ['abc', 'ho '], [['', 'empty input'], ['x', 'one character'], [rep('ab', 60), '120 characters']]),
    hints: ['You can only read the input once, so store it.', 'After storing, walk back to the start: `<[<]` stops on the empty cell before the text.', 'Then `>[.>]` prints forwards. Walk back and do it once more.'],
    learn: [L.input, L.patterns],
    solutions: [sol('Store, rewind, print, rewind, print', [['>,[>,]', 'the text from cell 1 on'], ['<[<]', 'walk back to the empty cell 0'], ['>[.>]', 'print forwards'], ['<[<]', 'walk back again'], ['>[.>]', 'print forwards again']])],
    explain: 'Two fences, one empty cell before the text and one after it, let you run back and forth over the text as often as you like: `[<]` runs left to the fence, `[>]` runs right.',
  });
  add({
    id: 'mirror', group: 'text', title: 'Mirror', level: 3,
    text: 'Print the input followed by the input backwards: `abc` becomes `abccba`. The input can be empty and never holds the character with number 0.',
    tests: io((s) => s + s.split('').reverse().join(''), ['abc', 'no'], [['', 'empty input'], ['x', 'one character becomes two'], ['step on', '']]),
    hints: ['Combine the cat program with the backwards program.', 'Print each character as you store it.', '`>,[.>,]` and then walk back printing.'],
    learn: [L.input, L.patterns],
    solutions: [sol('Print while storing, then walk back', [['>,', 'read into cell 1'], ['[.>,]', 'print it and read the next into the next cell'], ['<[.<]', 'walk back printing']])],
    explain: 'The forward half costs one extra full stop inside the loop that stores the text.',
  });
  add({
    id: 'swap-pairs', group: 'text', title: 'Swapped pairs', level: 4,
    text: 'Swap every two characters: `abcdef` becomes `badcfe`. If one character is left over at the end, print it as it is: `abc` becomes `bac`. The input never holds the character with number 0.',
    tests: io((s) => s.replace(/(.)(.)/gs, '$2$1'), ['abcdef', 'abc'], [['', 'empty input'], ['x', 'one character, nothing to swap with'], ['ab', 'one pair'], ['hello world', 'an odd number of characters']]),
    hints: ['Read two characters into two cells and print the second one first.', 'At the end of an odd input the second cell holds 0. Printing that would print a character with number 0, which is wrong.', 'Print the second cell only if it is not zero: `[.[-]]` prints and clears it, so the brackets run once.'],
    learn: [L.decide, L.input],
    solutions: [sol('Second first, if there is a second', [[',', 'the first of a pair in cell 0'], ['[', 'while there is one'], ['>,', 'the second in cell 1'], ['[.[-]]', 'if it is there: print it and clear it'], ['<.', 'print the first'], [',', 'the first of the next pair'], [']', '']])],
    explain: 'A character with number 0 is still a character, and the checker sees it. `[.[-]]` is the shortest "if": it runs when the cell is not zero and clears the cell so that it stops.',
  });
  add({
    id: 'brackets', group: 'text', title: 'In brackets', level: 3,
    text: 'Print the input between square brackets: `loop` becomes `[loop]`. On an empty input print `[]`.',
    tests: io((s) => '[' + s + ']', ['loop', 'a b'], [['', 'empty input'], ['[]', 'brackets in the input are just characters'], ['x', '']]),
    hints: ['The brackets are characters 91 and 93.', 'Keep the 91 in its own cell. After the cat loop, go back to it and add 2.', '9 rounds of 10 is 90.'],
    learn: [L.numbers, L.input],
    solutions: [sol('Keep the bracket cell', [['+++++++++[>++++++++++<-]', 'cell 1 holds 90'], ['>+.', '91 is the opening bracket'], ['<,[.,]', 'copy the input using cell 0'], ['>++.', 'cell 1 plus 2 is 93: the closing bracket']])],
    explain: 'In the output a bracket is only character 91 or 93. It has nothing to do with the loop commands of your program.',
  });
  add({
    id: 'caesar', group: 'text', title: 'One letter on', level: 4,
    text: 'The input is made of small letters `a` to `z` only. Replace every letter by the next one in the alphabet, and `z` by `a`: `buzz` becomes `cvaa`. The input can be empty.',
    tests: io((s) => s.replace(/[a-z]/g, (c) => (c === 'z' ? 'a' : chr(c.charCodeAt(0) + 1))), ['buzz', 'hal'], [['', 'empty input'], ['z', 'only the letter that goes round'], ['a', ''], ['y', 'becomes z, not a'], ['zzz', ''], ['xyzabc', '']]),
    hints: ['Every letter but z just gets one added. So the question is: is this a z?', 'z is 122. Take 122 off: zero means z. Keep a flag cell that says "it was a z" and clear it when the cell is not zero.', 'If not z: add 123 back (the letter plus one) and print. Otherwise, in the flag branch, build 97 and print it.'],
    learn: [L.decide, L.patterns],
    solutions: [sol('Is it z? One branch or the other', [
      [',[', 'for every letter in cell 0'],
      ['>+', 'cell 1 is the flag: assume it is a z'],
      ['>+++++++++++[<<----------->>-]<<-', '11 rounds of 11 and one more: 122 off cell 0'],
      ['[', 'not zero: it was not a z'],
      ['>-', 'clear the flag'],
      ['>+++++++++++[<<+++++++++++>>-]<<++.', 'put back 123: the letter plus one: and print'],
      ['[-]]', 'empty the cell to leave this branch'],
      ['>[', 'the flag is still set: it was a z'],
      ['-', 'clear the flag'],
      ['>++++++++[<++++++++++++>-]<+.', 'make 97 in the flag cell and print a'],
      ['[-]]', 'clear it'],
      ['<,', 'next letter'],
      [']', ''],
    ])],
    explain: 'Brainfuck has "if not zero" but no "else". The usual answer is a flag cell: set it to 1, clear it inside the "if", and afterwards run a second "if" on the flag.',
  });

  add({
    id: 'empty', group: 'logic', title: 'Anything there?', level: 3,
    text: 'Print `Y` if the input holds at least one character, and `N` if it is empty.',
    tests: io((s) => (s.length ? 'Y' : 'N'), ['hello', ''], [['x', 'one character'], [' ', 'a space is a character'], ['N', '']]),
    hints: ['Read one character. On an empty input the cell is 0.', 'An "if" and an "else": set a flag, clear it inside the "if", then test the flag.', 'Or, shorter: Y is 89 and N is 78. Start from N and add 11 only if the cell is not zero.'],
    learn: [L.decide, L.patterns],
    solutions: [
      sol('If and else with a flag', [
        [',', 'read into cell 0'], ['>+<', 'cell 1 is the flag'],
        ['[', 'something was read'], ['>-', 'clear the flag'], ['>>+++++++++[<++++++++++>-]<-.', '9 rounds of 10 less 1: print Y from cell 2'], ['<<[-]', 'empty cell 0 to leave'], [']', ''],
        ['>[', 'the flag is still set: nothing was read'], ['>>++++++[<+++++++++++++>-]<.', '6 rounds of 13: print N from cell 2'], ['<-', 'clear the flag to leave'], [']', ''],
      ]),
      sol('One answer, changed if needed', [[',', 'read'], ['[[-]>+++++++++++<]', 'if something was read: clear it and put 11 in cell 1'], ['++++++[>+++++++++++++<-]', 'add 78 to cell 1'], ['>.', '78 is N: 89 is Y']], 'No "else" needed: both answers come from the same cell, and the "if" only decides whether 11 is added.'),
    ],
    explain: 'The first solution is the general shape of "if this, else that". The second shows a way round it that often works: do the common part always, and let the "if" only make the difference.',
  });
  add({
    id: 'zero-digit', group: 'logic', title: 'Zero or not', level: 3,
    text: 'Read one digit. Print `Z` if it is `0`, and `N` if it is not.',
    tests: io((s) => (s === '0' ? 'Z' : 'N'), ['0', '7'], [['1', 'the smallest digit that is not zero'], ['9', 'the largest digit'], ['5', '']]),
    hints: ['The character 0 is the number 48, which is not zero.', 'Take 48 off first. Then "is it the digit 0" is "is the cell zero".', 'Z is 90 and N is 78. Use a flag for if and else, or start from Z and take 12 off if the cell is not zero.'],
    learn: [L.decide, L.letters],
    solutions: [
      sol('If and else with a flag', [
        [',>++++++[<-------->-]', 'the digit in cell 0: 48 off'], ['+<', 'cell 1 is the flag'],
        ['[', 'not zero'], ['>-<[-]', 'clear the flag and the cell'], ['>>>++++++[<+++++++++++++>-]<.[-]', 'print N from cell 2 and clear it'], ['<<]', ''],
        ['>[', 'the flag is still set: zero'], ['>>+++++++++[<++++++++++>-]<.[-]', 'print Z from cell 2'], ['<-]', 'clear the flag'],
      ]),
      sol('Start from Z', [[',>++++++[<-------->-]<', '48 off'], ['[[-]>------------<]', 'if not zero: 12 below zero in cell 1'], ['+++++++++[>++++++++++<-]>.', 'add 90: Z or N']]),
    ],
    explain: 'Comparing with a fixed number is always: subtract that number and ask whether zero is left.',
  });
  add({
    id: 'same', group: 'logic', title: 'The same?', level: 3,
    text: 'Read two characters. Print `=` if they are the same, and `!` if they differ.',
    tests: io((s) => (s[0] === s[1] ? '=' : '!'), ['aa', 'ab'], [['ba', 'the second is smaller'], ['  ', 'two spaces'], ['az', 'far apart'], [chr(255) + chr(1), 'far apart, the other way'], ['zz', '']]),
    hints: ['Two numbers are the same when their difference is zero.', 'Subtract one from the other: `[<->-]`. It does not matter if the result goes below zero: it goes round and is still not zero.', '= is 61 and ! is 33, 28 apart.'],
    learn: [L.decide, L.copy],
    solutions: [sol('Subtract and look', [[',>,', 'two characters'], ['[<->-]<', 'cell 0 becomes the difference'], ['[[-]>----------------------------<]', 'if it is not zero: clear it and go 28 below zero in cell 1'], ['+++++++[>+++++++++<-]>--.', 'add 61: = or !']])],
    explain: 'Because cells go round, a "negative" difference is simply a large number. For the question "is it zero?" that is all the same.',
  });
  add({
    id: 'even-odd', group: 'logic', title: 'Even or odd', level: 4,
    text: 'Print `E` if the number of characters in the input is even, and `O` if it is odd. An empty input has 0 characters, which is even.',
    tests: io((s) => (s.length % 2 ? 'O' : 'E'), ['ab', 'abc'], [['', 'empty input: zero is even'], ['x', ''], [rep('x', 255), '255 characters'], [rep('x', 256), '256 characters'], ['four', '']]),
    hints: ['You do not need the count, only a switch that flips with every character.', 'Flipping a cell that is 0 or 1: put 1 in a spare cell, take the old value off it, move it back.', 'E is 69 and O is 79: add ten times the switch to 69.'],
    learn: [L.decide, L.copy, L.patterns],
    solutions: [sol('A switch that flips', [
      [',[', 'for every character in cell 0'],
      ['>>+', 'cell 2 becomes 1'], ['<[->-<]', 'if the switch in cell 1 is on: turn it off and cell 2 too'], ['>[-<+>]', 'move cell 2 into the switch'],
      ['<<,', 'next character'], [']', ''],
      ['>[->++++++++++<]', 'ten in cell 2 if the switch is on'],
      ['>>+++++++[<++++++++++>-]<-.', 'add 69: E or O'],
    ])],
    explain: 'New switch = 1 minus old switch. With cells that only hold 0 or 1 that is: start a spare cell at 1 and subtract the old value.',
  });
  add({
    id: 'underscore', group: 'logic', title: 'Fill the gaps', level: 4,
    text: 'Print the input with every space replaced by an underscore `_`: `a b c` becomes `a_b_c`. All other characters stay as they are.',
    tests: io((s) => s.replace(/ /g, '_'), ['a b c', 'hello world'], [['', 'empty input'], [' ', 'only a space'], ['   ', 'three spaces in a row'], ['none', 'no spaces at all'], ['!a', 'the character just after the space in the table'], [' end ', 'spaces at both ends']]),
    hints: ['A space is 32. Take 32 off: zero means space.', 'If it is not a space you must print the original: add the 32 back.', 'If and else with a flag. In the "else" branch print 95, the underscore.'],
    learn: [['Challenge 36: One letter on', 'play.html?c=caesar'], L.decide, L.patterns],
    solutions: [sol('Space or not', [
      [',[', 'for every character'],
      ['>+', 'flag in cell 1'],
      ['>++++[<<-------->>-]<<', '32 off cell 0'],
      ['[', 'not a space'], ['>-', 'clear the flag'], ['>++++[<<++++++++>>-]<<.', 'put the 32 back and print'], ['[-]]', ''],
      ['>[', 'a space'], ['-', 'clear the flag'], ['>++++++++[<++++++++++++>-]<-.', '96 less 1 is the underscore'], ['[-]]', ''],
      ['<,', 'next'], [']', ''],
    ])],
    explain: 'The same shape as challenge 36, One letter on: subtract what you are looking for, branch on zero or not, and repair the cell in the branch that needs it.',
  });
  add({
    id: 'no-spaces', group: 'logic', title: 'Close the gaps', level: 3,
    text: 'Print the input without its spaces: `a b c` becomes `abc`.',
    tests: io((s) => s.replace(/ /g, ''), ['a b c', 'hello world'], [['', 'empty input'], ['   ', 'only spaces: print nothing'], ['none', 'no spaces'], [' a', ''], ['!', 'the character just after the space in the table']]),
    hints: ['A filter: print only when a test says so.', 'Take 32 off. If the cell is not zero, it was not a space.', 'Inside the "if": add 32 back, print, clear the cell. There is no "else" to write.'],
    learn: [L.decide],
    solutions: [sol('Print only what is not a space', [[',[', 'for every character'], ['>++++[<-------->-]<', '32 off'], ['[', 'not a space'], ['>++++[<++++++++>-]<.', 'put 32 back and print'], ['[-]]', 'clear to leave'], [',]', 'next']])],
    explain: 'A filter is an "if" without an "else". The cell has to be zero at the closing bracket either way, so clearing it does double duty.',
  });
  add({
    id: 'larger', group: 'logic', title: 'The larger one', level: 5,
    text: 'Read two digits and print the larger of the two: `38` gives `8`. If they are equal, print that digit once.',
    tests: io((s) => (s[0] > s[1] ? s[0] : s[1]), ['38', '72'], [['55', 'equal digits'], ['09', 'the smallest and the largest'], ['90', 'the same, the other way round'], ['00', ''], ['12', 'one apart'], ['21', '']]),
    hints: ['"Is a larger than b" is not a question brainfuck can ask. But it can count both down together and see which one is empty first.', 'Count the first down to zero. Each round, take one off the second too, but only if the second is not zero yet. And count the rounds.', 'The rounds are as many as the first number. What is left of the second is how much larger it was. Rounds plus leftover is the larger one.'],
    learn: [L.decide, L.zero, L.patterns],
    solutions: [sol('Count both down, add what is left', [
      [',>,<', 'the digits in cells 0 and 1: stand on the first'],
      ['[', 'for every one in the first'],
      ['>[-[>>+<<-]]', 'if the second is not zero: take one off and park the rest in cell 3'],
      ['>>[<<+>>-]', 'bring the rest back'],
      ['<+', 'count this round in cell 2'],
      ['<<-', 'one off the first'],
      [']', ''],
      ['>[>+<-]', 'add what is left of the second to the count'],
      ['>.', 'that is the larger character'],
    ])],
    explain: 'No conversion is needed: the two characters are compared as the numbers they are. The count ends up equal to the first, plus whatever the second had on top of it, which is the larger of the two.',
  });
  add({
    id: 'count-a', group: 'logic', title: 'Count the a', level: 4,
    text: 'Print how many times the small letter `a` occurs in the input, as one digit. It occurs at most 9 times: `banana` gives `3`.',
    tests: io((s) => d(s.split('a').length - 1), ['banana', 'hello'], [['', 'empty input gives 0'], ['aaaaaaaaa', 'nine times'], ['ABBA', 'capitals do not count'], ['`ab', 'the neighbours of a in the table'], ['a', '']]),
    hints: ['Take 97 off every character. Zero means it was an a.', 'You need "if zero", but brackets give "if not zero". Use a flag: set it to 1 and clear it when the cell is not zero.', 'Then add the flag to the counter. At the end add 48 to the counter and print.'],
    learn: [L.decide, L.patterns],
    solutions: [sol('A flag that survives only for an a', [
      [',[', 'for every character in cell 0'],
      ['>+', 'flag in cell 1'],
      ['>>++++++++[<<<------------>>>-]<<<-', '8 rounds of 12 and one more: 97 off cell 0'],
      ['[>-<[-]]', 'not zero: clear the flag and the cell'],
      ['>[->+<]', 'add the flag to the counter in cell 2'],
      ['<,', 'next'], [']', ''],
      ['>>>++++++[<++++++++>-]<.', 'counter plus 48'],
    ])],
    explain: '"If zero" is built from "if not zero" by turning it round: assume yes, and let the "if not zero" take the yes away.',
  });

  add({
    id: 'no-plus', group: 'tricky', title: 'No plus', level: 3, ban: '+',
    text: 'Print `A` without using the command `+` anywhere. There is no input.',
    tests: fixed('A'),
    hints: ['A cell that holds 0 becomes 255 when you take one off.', 'So 191 minus signs reach 65 from above. That is a correct answer.', 'Loops work downwards too: a loop that takes 3 from another cell, 63 times, takes off 189.'],
    learn: [L.machine, L.reference],
    solutions: [
      sol('Down from the top with a loop', [['----', 'cell 0 holds 252'], ['[>---<----]', '63 rounds: each takes 3 off cell 1'], ['>--.', '189 below zero is 67: two less is 65']]),
    ],
    explain: 'Cells count round like a mileage counter: below 0 comes 255. With that, minus alone can reach every number, and a loop still saves most of the typing.',
  });
  add({
    id: 'any-eof', group: 'tricky', title: 'Copy the input, anywhere', level: 5,
    text: 'Brainfuck interpreters do not agree on what `,` does when the input has run out. Some put 0 in the cell, some put 255, and some leave the cell as it was. Write a program that copies the input and stops, on all three kinds. The input never holds the characters with numbers 0 or 255.',
    tests: (() => {
      const cases = [];
      const names = { 0: 'the cell becomes 0', 255: 'the cell becomes 255', same: 'the cell is left unchanged' };
      for (const eof of [0, 255, 'same']) {
        cases.push({ in: 'hello', out: 'hello', eof, note: 'at the end of input ' + names[eof] });
        cases.push({ in: '', out: '', eof, hidden: true, note: 'empty input, and at the end of input ' + names[eof] });
        cases.push({ in: 'a b\nc', out: 'a b\nc', eof, hidden: true, note: 'at the end of input ' + names[eof] });
      }
      return cases;
    })(),
    hints: ['"Unchanged" can be turned into "0": clear the cell before every comma.', 'Now the end is 0 or 255. Add one: 255 becomes 0. So after adding one, "not zero" means "not 255".', 'Inside that test take the one off again and test for "not 0". Only then print, and set a flag that keeps the outer loop going.'],
    learn: [L.reference, L.decide, L.input],
    solutions: [sol('Two tests in a row', [
      ['+[', 'cell 0 is the flag "go on": start with 1'],
      ['-', 'assume this is the last round'],
      ['>[-],', 'clear cell 1 and read: at the end it is 0 or 255 now'],
      ['+[', 'add one: not zero means it was not 255'],
      ['-', 'take the one off again'],
      ['[', 'not zero: a real character'],
      ['.', 'print it'],
      ['[-]', 'clear it to leave'],
      ['<+>', 'set the flag: go on'],
      [']', ''],
      [']', 'the cell is zero here in every case'],
      ['<', 'back to the flag'],
      [']', ''],
    ])],
    explain: 'Clearing first deals with "unchanged". Adding one before the first test deals with 255, taking it off before the second test deals with 0. A real character passes both tests, is printed, and sets the flag for another round.',
  });
  add({
    id: 'long-count', group: 'tricky', title: 'A long count', level: 5, bits: 16,
    text: 'Print the number of characters in the input in ordinary digits: an input of 300 characters gives `300`. The input has at most 1,000 characters and can be empty (print `0`). The cells here are 16 bit: they hold 0 to 65,535.',
    tests: io((s) => d(s.length), ['hello', rep('x', 12)], [['', 'empty input gives 0'], [rep('x', 9), 'one digit'], [rep('x', 10), 'the first two-digit count'], [rep('ab', 128), '256 characters: one more than an 8 bit cell can count'], [rep('x', 300), '300 characters'], [rep('y', 1000), 'the longest input: 1,000 characters'], [rep('z', 101), 'a zero in the middle']]),
    hints: ['Counting is easy: one cell goes up for every character. With 16 bit cells it does not go round before 65,536.', 'The work is printing a number with several digits. See challenge 27, Its number.', 'Peel off digits by dividing by 10, store them, and print them walking back.'],
    learn: [['Challenge 27: Its number', 'play.html?c=print-number'], L.patterns, L.reference],
    solutions: [sol('Count, then print the number', [['>>>,[<+>,]', 'count the characters in cell 2 while reading into cell 3'], ['<<+', 'flag 1 in cell 1: cell 0 stays empty']].concat(PRINT_NUMBER))],
    explain: 'The printing part is the same as in challenge 27, Its number, and does not care how large a cell is. With 8 bit cells the count itself would go round at 256, and you would need two cells and a carry.',
  });
  add({
    id: 'upper-mixed', group: 'tricky', title: 'Shout, carefully', level: 5,
    text: 'Print the input with every small letter `a` to `z` made a capital. Everything else stays as it is: `Hi, there!` becomes `HI, THERE!`.',
    tests: io((s) => s.replace(/[a-z]/g, (c) => c.toUpperCase()), ['Hi, there!', 'abc'], [['', 'empty input'], ['`a', 'the character just before a in the table must stay'], ['z{', 'the character just after z must stay'], ['AZ az', 'capitals stay capitals'], ['123 ~', 'digits and signs'], ['az', 'the first and the last letter']]),
    hints: ['A small letter is a number from 97 to 122. Take 97 off: now small letters are 0 to 25, and everything else is larger (smaller numbers went round below zero).', '"Is it at most 25?": take 1 off, 25 times, but never below zero. If zero is left, it was a small letter.', '"Take 1 off but not below zero" is an "if not zero" around the minus. Do this on a copy, and take 32 off the original if the test says so.'],
    learn: [L.decide, L.zero, L.patterns],
    solutions: [sol('Test a copy, change the original', [
      [',[', 'for every character in cell 0'],
      ['[->+>+<<]>>[-<<+>>]', 'copy it to cell 1'],
      ['++++++++[<------------>-]<-', '97 off the copy: small letters are now 0 to 25'],
      ['>+++++[>+++++<-]>', 'cell 3 counts 25 rounds'],
      ['[', '25 times'],
      ['<<[-[>>>+<<<-]]', 'if the copy is not zero: one off and park the rest in cell 4'],
      ['>>>[<<<+>>>-]', 'bring the rest back'],
      ['<-]', 'one round done'],
      ['<+', 'flag in cell 2: assume a small letter'],
      ['<[[-]>-<]', 'if anything is left of the copy: clear it and the flag'],
      ['>[-', 'a small letter'],
      ['>++++[<<<-------->>>-]', '32 off the original'],
      ['<]', ''],
      ['<<.', 'print the original'],
      [',]', 'next'],
    ])],
    explain: 'Brainfuck cannot ask "is it between 97 and 122". But after subtracting 97 the question is "is it below 26", and a subtraction that stops at zero answers that: only numbers up to 25 reach zero in 25 careful steps.',
  });
  add({
    id: 'binary', group: 'tricky', title: 'In bits', level: 5,
    text: 'Read one character and print its number as eight binary digits, highest first: `A` (65) gives `01000001`.',
    tests: io((s) => (s.charCodeAt(0) + 256).toString(2).slice(1), ['A', 'a'], [[chr(255), 'all eight bits set'], [chr(1), 'only the lowest bit'], [chr(128), 'only the highest bit'], [' ', '32'], ['U', 'bits alternate: 01010101']]),
    hints: ['Dividing by 2 gives the lowest bit as the remainder. Do it eight times.', 'That gives the bits lowest first. Store them and print them walking back.', 'It is the program of challenge 27, Its number, with 2 for 10, and with a counter of 8 rounds that moves along with the work.'],
    learn: [['Challenge 27: Its number', 'play.html?c=print-number'], L.peel, L.patterns],
    solutions: [sol('Halve eight times, print backwards', [
      ['>++++++++>,<', 'cell 0 stays empty: 8 rounds in cell 1: the number in cell 2'],
      ['[', 'while rounds are left'],
      ['>>++<', 'put 2 two cells to the right and stand on the number'],
      ['[->-[>+>>]>[+[-<+>]>+>>]<<<<<]', 'divide by 2: remainder and half land in the next two cells'],
      ['>[-]', 'wipe what is left of the 2'],
      ['<<-[->+<]', 'one round fewer: and move the counter one cell to the right'],
      ['+', 'this cell becomes 1'],
      ['>>>[-<<<+>>>]', 'add the remainder: this cell is now bit plus 1'],
      ['>[-<<+>>]', 'move the half next to the counter'],
      ['<<<', 'stand on the counter'],
      [']', ''],
      ['<[', 'walk back over the eight bits'],
      ['>++++++[<++++++++>-]<-.', 'add 47: bit plus 1 becomes 0 or 1 as a character'],
      ['[-]<', 'wipe it and go to the bit before'],
      [']', ''],
    ])],
    explain: 'Halving peels off one bit at a time, the lowest first (Model lesson 5, The way through: peeling off bits, does this on a large scale). Storing each bit plus 1 keeps a 0 bit from looking like the empty cell that ends the walk back.',
  });
  add({
    id: 'product', group: 'tricky', title: 'Times, in full', level: 5,
    text: 'Read two digits and print their product in ordinary digits: `67` gives `42` and `99` gives `81`.',
    tests: io((s) => d(+s[0] * +s[1]), ['67', '23'], [['00', 'zero'], ['99', 'the largest product: 81'], ['09', 'zero times something'], ['90', 'something times zero'], ['25', 'ends in a zero: 10'], ['11', ''], ['52', 'the same product the other way round']]),
    hints: ['Two challenges in one: challenge 25, Times, and challenge 27, Its number.', 'Put the product where the number printer expects it, and leave the cells to its right empty.', 'Clear the second digit after multiplying: the divider needs clean cells.'],
    learn: [['Challenge 25: Times', 'play.html?c=multiply'], ['Challenge 27: Its number', 'play.html?c=print-number'], L.multiply, L.patterns],
    solutions: [sol('Multiply, tidy up, print the number', [
      ['>>>,>,', 'the digits in cells 3 and 4'],
      ['>++++++[<--------<-------->>-]', '48 off both'],
      ['<<', 'stand on the first'],
      ['[-', 'for every one in the first'],
      ['>[-<<+>>>+<]', 'add the second to cell 2 and to cell 5'],
      ['>[-<+>]', 'restore the second from cell 5'],
      ['<<]', ''],
      ['>[-]', 'clear the second'],
      ['<<<+', 'flag 1 in cell 1: the product is in cell 2'],
    ].concat(PRINT_NUMBER))],
    explain: 'Larger programs are made of parts with an agreement about the tape: where the input of a part stands and which cells it may use. Here the multiplier leaves its answer in cell 2 and cleans up behind it, because the number printer needs zeros to its right.',
  });
  add({
    id: 'balanced', group: 'tricky', title: 'Do the brackets match?', level: 5,
    text: 'The input is made of the characters `[` and `]` only, at most 100 of them. Print `Y` if it could be the brackets of a correct brainfuck program: every `[` has its own `]` further on. Otherwise print `N`. So `[[][]]` gives `Y`, and `][` gives `N`.',
    tests: io((s) => { let dp = 0; for (const c of s) { dp += c === '[' ? 1 : -1; if (dp < 0) return 'N'; } return dp === 0 ? 'Y' : 'N'; }, ['[[][]]', '][', '[['], [['', 'no brackets at all is correct'], ['[]', ''], [']', 'only a closing bracket'], ['[]]', 'one closing bracket too many, at the end'], ['[]][[]', 'as many of each, but the middle closes too early'], [rep('[', 50) + rep(']', 50), 'fifty deep'], [rep('[]', 50), 'fifty pairs'], [rep('[', 51) + rep(']', 49), 'the count ends at 2'], ['[][', '']]),
    hints: ['Keep a depth: up for `[`, down for `]`. At the end it must be zero.', 'That is not enough: `][` ends at zero too. A `]` at depth zero is wrong at once. Remember that in a cell of its own.', '`[` is 91 and `]` is 93. Take 91 off: zero means open. For a close: if the depth is not zero take one off, otherwise set the "wrong" cell. At the end: Y only if depth and "wrong" are both zero.'],
    learn: [L.decide, L.reading, L.patterns],
    solutions: [sol('A depth and a "wrong" cell', [
      [',[', 'for every character in cell 0'],
      ['>+++++++++[<---------->-]<-', '91 off: an opening bracket is now 0 and a closing one 2'],
      ['>+<', 'flag in cell 1: assume it opens'],
      ['[', 'it closes'],
      ['[-]>-', 'clear the cell and the flag'],
      ['>>>+<<', 'cell 4 is a second flag: assume the depth is zero'],
      ['[-', 'the depth in cell 2 is not zero: one off'],
      ['>>-<<', 'clear the second flag'],
      ['[>>>+<<<-]]', 'park the rest of the depth in cell 5'],
      ['>>>[<<<+>>>-]', 'bring it back'],
      ['<[-<[-]+>]', 'second flag still set: cell 3 "wrong" becomes 1'],
      ['<<<<]', 'back to cell 0'],
      ['>[->+<]', 'it opens: add the flag to the depth'],
      ['<,', 'next'],
      [']', ''],
      ['>>>[-<+>]', 'add "wrong" to the depth'],
      ['<[[-]<+>]', 'if that is not zero: cell 1 becomes 1'],
      ['<[->-----------<]', 'in that case go 11 below zero in cell 2'],
      ['+++++++++[>++++++++++<-]>-.', 'add 89: Y or N'],
    ])],
    explain: 'This is what every brainfuck interpreter does before it runs your program. The depth alone cannot tell `][` from `[]`, so a second cell records the one mistake that the final depth does not show.',
  });

  const PROJECTS = [
    {
      id: 'calculator', title: 'A one-digit calculator',
      text: 'Read a sum such as `3+4` or `9-5` and print the answer. Start small and grow it.',
      checklist: ['It adds two digits when the answer is below 10: `3+4` gives `7`.', 'It subtracts: `9-5` gives `4`.', 'It looks at the middle character to choose between adding and subtracting.', 'It prints answers of two digits: `7+8` gives `15`.', 'It handles a negative answer: `3-5` gives `-2`.', 'It also multiplies: `6*7` gives `42`.'],
      tips: ['The plus sign is 43, the minus sign 45 and the star 42. Take 43 off the middle character and branch on zero.', 'For two digits, reuse the number printer from the challenge "Its number".', 'Decide which cells hold what before you type, and write that down as a comment at the top.'],
      tries: [['3+4', '7'], ['9-5', '4'], ['7+8', '15']],
      learn: [['Challenge: Adding', 'play.html?c=add-digits'], ['Challenge: Its number', 'play.html?c=print-number'], L.decide],
    },
    {
      id: 'reverser', title: 'A line-by-line reverser',
      text: 'Read several lines and print each line backwards, keeping the lines in their order: `abc` and `de` on two lines become `cba` and `ed`.',
      checklist: ['It reverses a single line that ends with a line break.', 'It handles several lines.', 'It handles an empty line in the middle.', 'It handles a last line without a line break.', 'It uses the same cells again for every line, so the tape does not fill up.'],
      tips: ['Store one line, print it walking back, and clear the cells as you go: `[.[-]<]`.', 'To stop at a line break, take 10 off after reading (see the challenge "The first line").', 'The end of the input and the end of a line are two different stops. Deal with one first.'],
      tries: [['abc\nde\n', 'cba\ned\n'], ['one\n\ntwo\n', 'eno\n\nowt\n']],
      learn: [['Challenge: Backwards', 'play.html?c=reverse'], ['Challenge: The first line', 'play.html?c=first-line'], L.patterns],
    },
    {
      id: 'guesser', title: 'A number guesser with fixed input',
      text: 'Your program holds a secret digit. The input is a row of guesses, such as `528`. For each guess print `<` if the secret is smaller, `>` if it is larger, and `=` when the guess is right, and stop after the right guess.',
      checklist: ['It answers one guess correctly.', 'It answers a row of guesses.', 'It stops reading after a right guess.', 'It prints a short text at the end, such as "Got it".', 'It counts the guesses and prints the count.', 'The secret is easy to change: one place in the program.'],
      tips: ['Comparing two digits: see the challenge "The larger one". You need to know which one ran out first.', 'Keep the secret safe: work on a copy for every guess.', 'A program cannot ask the player questions while it runs on this site: all the input is given before it starts. That is what "fixed input" means.'],
      tries: [['528', 'for a secret of 8: >>=']],
      learn: [['Challenge: The larger one', 'play.html?c=larger'], ['Challenge: The same?', 'play.html?c=same'], L.copy],
    },
    {
      id: 'chart', title: 'A bar chart',
      text: 'Read a row of digits and draw one bar of stars per digit, each on its own line: `314` gives a line of 3 stars, a line of 1 and a line of 4.',
      checklist: ['It draws one bar.', 'It draws a bar for every digit of the input.', 'A 0 gives an empty line.', 'Every bar starts with its digit and a space: `3 ***`.', 'The bars are drawn standing up instead of lying down.'],
      tips: ['One bar is the challenge "That many stars". Wrap it in the reading loop of the cat program.', 'Keep the star and the line break in cells of their own and do not touch them inside the loop.', 'Standing bars are much harder: you need the whole input on the tape and one pass per row.'],
      tries: [['314', '***\n*\n****\n']],
      learn: [['Challenge: That many stars', 'play.html?c=n-stars'], ['Challenge: A triangle', 'play.html?c=triangle'], L.program],
    },
    {
      id: 'cipher', title: 'Your own secret code',
      text: 'Write two programs: one that turns a text into a secret text, and one that turns it back. Start with the simplest code there is and make it harder to guess.',
      checklist: ['An encoder that changes every character in the same way (for example, plus 1).', 'A decoder that gives the original back.', 'Spaces stay spaces.', 'Letters stay letters: after `z` comes `a`.', 'The shift changes along the text (plus 1, plus 2, plus 3, ...).', 'One program does both: the first input character chooses encode or decode.'],
      tips: ['See the challenge "One letter on" for going round at z.', 'Run the encoder, copy its output, and paste it as the input of the decoder.', 'Shifting by 13 is special: the same program encodes and decodes. Why?'],
      tries: [['hello', 'with plus 1: ifmmp']],
      learn: [['Challenge: One letter on', 'play.html?c=caesar'], ['Challenge: Fill the gaps', 'play.html?c=underscore'], L.decide],
    },
  ];

  // ---- derived: program text, lengths, targets
  for (const c of C) {
    for (const s of c.solutions) {
      const w = Math.min(34, Math.max.apply(null, s.lines.map((l) => l[0].length)));
      s.text = s.lines.map((l) => (l[1] ? l[0] + rep(' ', Math.max(1, w - l[0].length) + 2) + l[1] : l[0])).join('\n');
      s.code = s.lines.map((l) => l[0]).join('');
      s.length = s.code.length;
    }
    const gold = Math.min.apply(null, c.solutions.map((s) => s.length)), ref = c.solutions[0].length;
    const silver = gold + Math.max(1, Math.ceil(gold * 0.2));
    const bronze = Math.max(ref, gold + Math.max(2, Math.ceil(gold * 0.5)), silver + 1);
    c.targets = { gold, silver, bronze };
    c.bits = c.bits || 8;
    if (c.eof === undefined) c.eof = 0;
  }
  const byId = {};
  C.forEach((c, i) => { byId[c.id] = c; c.n = i + 1; });
  const medal = (c, len) => (len <= c.targets.gold ? 'gold' : len <= c.targets.silver ? 'silver' : len <= c.targets.bronze ? 'bronze' : '');

  return { GROUPS, CHALLENGES: C, PROJECTS, byId, medal };
})();
