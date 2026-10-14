// The example library of the playground.
(function (root, factory) {
  root.PGExamples = factory(root.PG);
})(typeof self !== 'undefined' ? self : this, function (PG) {
  'use strict';
  const L = (s) => s.replace(/^\n/, '');

  const basics = [
    { id: 'add', title: 'Add one', about: 'The smallest program: three plus signs leave 3 in cell 0.', code: L(`
+      add one to cell 0
+      and one more
+      cell 0 now holds 3
`) },
    { id: 'move', title: 'Move the pointer', about: 'Walk along the tape and leave a number in three cells.', code: L(`
+++    cell 0 becomes 3
>      one step right to cell 1
++     cell 1 becomes 2
>>     two steps right to cell 3
+      cell 3 becomes 1
<<<    three steps left   back on cell 0
`) },
    { id: 'loop', title: 'A loop', about: 'Five rounds: each takes 1 from the counter and adds 2 to its neighbour.', names: { 0: 'counter', 1: 'total' }, code: L(`
+++++      the counter   cell 0 becomes 5
[          is the counter zero   if not go in
  >++      add 2 to cell 1
  <-       back to the counter and take one off
]          is the counter zero   if not go round again
           at the end cell 0 is 0 and cell 1 is 10
`) },
    { id: 'clear', title: 'Clear a cell', about: 'The idiom for "make this cell zero", whatever it held.', code: L(`
+++++++    put 7 in cell 0
[-]        take one off until it is zero
           this works whatever the cell held
`) },
    { id: 'moveval', title: 'Move a value', about: 'Pour cell 0 into cell 1, one unit a round.', names: { 0: 'from', 1: 'to' }, code: L(`
+++++      cell 0 becomes 5
[->+<]     each round takes one from cell 0 and gives one to cell 1
           cell 0 ends at 0 and cell 1 at 5
`) },
    { id: 'copy', title: 'Copy a value', about: 'Reading a cell empties it, so copy into two cells and move one back.', names: { 0: 'value', 1: 'copy', 2: 'spare' }, code: L(`
+++++          cell 0 becomes 5
[->+>+<<]      pour cell 0 into cell 1 and cell 2 at the same time
>>[-<<+>>]     pour cell 2 back into cell 0
<<             cell 0 is 5 again and cell 1 is the copy
`) },
  ];

  const printing = [
    { id: 'letter', title: 'Print one letter', about: 'Make 65 as 8 times 8 plus 1 and print it: the letter A.', code: L(`
++++++++         cell 0 becomes 8
[>++++++++<-]    eight rounds of 8 make 64 in cell 1
>+               one more makes 65
.                print cell 1 as a character   65 is the letter A
`) },
    { id: 'hello', title: 'Hello World! with comments', about: 'One loop makes four useful numbers; the rest nudges them from letter to letter.', code: L(`
++++++++                 cell 0 counts 8 rounds
[
  >+++++++++             cell 1 gets 9 each round    it ends at 72
  >+++++++++++++         cell 2 gets 13 each round   it ends at 104
  >++++                  cell 3 gets 4 each round    it ends at 32
  >+++++++++++           cell 4 gets 11 each round   it ends at 88
  <<<<-                  back to the counter and take one off
]
>.                       cell 1 is 72    H
>---.                    cell 2 down to 101    e
+++++++..                up to 108    l two times
+++.                     up to 111    o
>.                       cell 3 is 32    a space
>-.                      cell 4 down to 87    W
<<.                      cell 2 is still 111    o
+++.                     114    r
------.                  108    l
--------.                100    d
>+.                      cell 3 up to 33    the exclamation mark
<<<++++++++++.           cell 0 was empty    10 is a line break
`) },
    { id: 'hello-short', title: 'Hello World! short', about: 'The same text from the Text to brainfuck tool on this page, without comments.', code: PG.textToBf('Hello World!\n', { comments: false }).code },
    { id: 'alphabet', title: 'The alphabet', about: 'A counter of 26 and a letter that goes up by one each round.', names: { 0: 'to go', 2: 'letter' }, code: L(`
++++++++++++++++++++++++++   cell 0 counts 26 letters
>++++++++[>++++++++<-]>+     cell 2 becomes 65   the letter A   8 times 8 and one more
<<                           back to the counter
[
  >>.+                       print the letter and make it the next one
  <<-                        one letter fewer to go
]
`) },
  ];

  const arithmetic = [
    { id: 'add-digits', title: 'Add two digits', about: 'Reads two digits and prints their sum (as long as it is below 10).', input: '34', names: { 0: 'first', 1: 'second' }, code: L(`
,                  read the first digit into cell 0    the character 3 is the number 51
>,                 read the second digit into cell 1
>++++++++          cell 2 counts 8 rounds
[<------>-]        each round takes 6 from cell 1    48 in all
                   cell 1 now holds the number itself   4 and not 52
<[<+>-]            add cell 1 to cell 0 one at a time
<.                 cell 0 is 51 and 4 more    55 is the character 7
`) },
    { id: 'multiply', title: 'Multiply two digits', about: 'Reads two digits, multiplies them with a loop in a loop and prints the product as a number.', input: '67',
      names: { 0: 'a', 1: 'b', 2: 'product', 3: 'ten count', 4: 'flag', 6: 'tens' }, code: L(`
,>,<                   read two digits into cell 0 and cell 1
>>++++++++             cell 2 counts 8 rounds
[<------<------>>-]    take 48 from both   now they are numbers and not characters
<<                     back on cell 0

[                      for every unit of cell 0
  >[->+>+<<]           add cell 1 to cell 2 and to a spare in cell 3
  >>[-<<+>>]           pour the spare back into cell 1
  <<<-                 one unit of cell 0 is done
]                      cell 2 now holds the product

>>>++++++++++<         cell 3 counts down from 10   the pointer is back on the product
[                      for every unit of the product
  -                    take it
  >-                   one off the count of ten
  >+<                  cell 4 is a flag   set it to 1
  [>-]                 if the count is not zero   step onto the flag and clear it
  >                    now on the flag if the count was zero   one cell further if not
  [                    the count reached zero   that is a full ten
    <++++++++++        start the count again at 10
    >>>+               one more ten in cell 6
    <<-                clear the flag
    >                  step past it so that both ways end on cell 5
  ]
  <<<                  back to the product
]

>>>>                   to cell 6   the tens
[                      only if there is at least one ten
  >++++++++[<++++++>-]<    add 48 to turn the number into a digit character
  .                    print the tens digit
  [-]                  empty the cell so that this part runs once
]
<<                     cell 4 is free again
>++++++++[<+++++++>-]<++   put 58 in it    that is the digit 0 and ten more
<[->-<]                take off what is left of the count of ten
>.                     what remains is the units digit   print it
`) },
  ];

  const input = [
    { id: 'echo', title: 'Echo', about: 'Prints everything it reads. It stops at the end of the input, which must be reported as 0 (the classic setting).', input: 'Hello!', code: L(`
,          read one character
[          as long as it is not zero   zero means the end of the input
  .        print it
  ,        read the next one
]
`) },
    { id: 'reverse', title: 'Reverse a line', about: 'Stores a line on the tape, one character a cell, then walks back and prints it. The input must end with a line break.', input: 'stressed\n', code: L(`
>                  leave cell 0 empty as a stop mark
,                  read the first character
----------         take 10 off   a line break is 10 so it becomes zero
[                  it was not the end of the line
  ++++++++++       put the 10 back
  >,               next cell   next character
  ----------       the same test
]
<                  step back onto the last character
[.<]               print and walk left until the empty cell 0
`) },
    { id: 'upper', title: 'Upper case', about: 'Turns small letters into capitals and leaves everything else alone. Written with this project\'s emit.js; about 2,000 steps a character.', input: 'Hello, World!',
      names: { 0: 'char', 1: 'char less 96', 2: 'past z', 7: 'flag' }, code: L(`
,          read the first character into cell 0
[          as long as it is not the end of the input

copy the character to cell 1
  [->+>>+<<<]>>>[-<<<+>>>]

take 96 from the copy but never go below zero   a becomes 1 and z becomes 26
  >>++++++++++[-<+++++++++>]<++++++[-<<<[->>>>+>+<<<<<]>>>>>[-<<<<<+>>>>>]<[<<<<->>>>[-]]<]

copy that to cell 2
  <<<[->+>+<<]>>[-<<+>>]

take 26 from it the same way   zero means the character is not past z
  >>+++++[-<+++++>]<+[-<<[->>>+>+<<<<]>>>>[-<<<<+>>>>]<[<<<->>>[-]]<]

if cell 1 is not zero the character is a or later
  <<<[

  and if cell 2 is zero it is a small letter   take 32 off to make it a capital
    >>>>>>+<<<<<[->>>+>+<<<<]>>>>[-<<<<+>>>>]<[>>-<<[-]]>>[<<<<<<<-------------------------------->>>>>>>[-]]

  empty cell 1 so that this part runs once
    <<<<<<[-]]

empty cell 2 and print the character
  >[-]
  <<.

empty cell 0 and read the next character
  [-],
]
`) },
  ];

  const classics = [
    { id: 'triangle', title: 'A triangle of stars', about: 'A loop in a loop: every row prints one star more than the row before.',
      names: { 0: 'rows to go', 1: 'stars', 4: 'star', 5: 'line break' }, code: L(`
>>>>>++++++[<+++++++>-]    cell 4 becomes 42   the star
++++++++++                 cell 5 becomes 10   the line break
<<<<<+++++                 cell 0 counts 5 rows
[                          for every row
  >+                       this row has one star more than the last
  [->+>+<<]                copy the number of stars to cell 2 and cell 3
  >>[-<<+>>]               pour cell 3 back into cell 1
  <                        on cell 2   the copy
  [>>.<<-]                 print a star for every unit of the copy
  >>>.                     print the line break
  <<<<<-                   back to the row counter   one row done
]
`) },
    { id: 'fibonacci', title: 'Fibonacci numbers', about: 'Prints the Fibonacci numbers below 100, with a routine that prints a cell as a number.',
      names: { 0: 'to go', 1: 'a', 2: 'b', 3: 'print', 4: 'ten count', 7: 'tens', 9: 'space' }, code: L(`
+++++++++++                  cell 0 counts 11 numbers
>+>+                         cell 1 and cell 2 start as 1 and 1
>>>>>>>>++++[<++++++++>-]    cell 9 becomes 32   the space
<<<<<<<<<<                   back on cell 0
[
  >[->>+>+<<<]               copy cell 1 into cell 3 and cell 4
  >>>[-<<<+>>>]              pour cell 4 back into cell 1
  <                          on cell 3   the number to print

  print cell 3 as a number   the same routine as in Multiply two digits
  >++++++++++<
  [->->+<[>-]>[<++++++++++>>>+<<->]<<<]
  >>>>[>++++++++[<++++++>-]<.[-]]
  <<>++++++++[<+++++++>-]<++
  <[->-<]>.
  [-]                        empty the digit cell
  >>>>.                      print the space
  <<<<<<<<                   back on cell 1

  the next pair   a becomes b and b becomes a and b together
  [->>+<<]                   old a to cell 3
  >[-<+>>>+<<]               b into cell 1 and into cell 4
  >[-<+>]                    cell 3 into b
  >[-<<+>>]                  cell 4 into b
  <<<<-                      back to the counter   one number done
]
`) },
    { id: 'long-count', title: 'A long count', about: 'Nothing but counting: about 26 million steps. Try Play fast, then Play at full speed, and compare.', settings: { bits: 8, overflow: 'wrap' }, code: L(`
++++++++++++++++++++++++++++++++++++++++   cell 0 counts 40 rounds
[
  >-                 cell 1 goes round from 0 to 255
  [
    >-               so does cell 2
    [                255 rounds
      >+<            count them in cell 3
      >[-]<          and throw the count away
      -
    ]
    <-
  ]
  <-
]
`) },
  ];

  const groups = [
    { title: 'The basics', about: 'One idea each. Step through them and read the line that starts with Next.', items: basics },
    { title: 'Printing', about: 'The full stop prints a cell as a character.', items: printing },
    { title: 'Arithmetic', about: 'Numbers come in as characters: the digit 3 is the number 51.', items: arithmetic },
    { title: 'Reading input', about: 'The comma reads one byte from the input box.', items: input },
    { title: 'Longer programs', about: 'Written for this site.', items: classics },
  ];

  // ---- made by the project's own generators, when the page hands them over ----
  function generated(Emitter, Patterns) {
    const E = () => new Emitter();
    const items = [
      { id: 'gen-copy', title: 'copy', about: 'Emitter.copy(0, 1, 2): cell 1 gets the value of cell 0, cell 2 is the spare.', code: E().add(0, 5).copy(0, 1, 2).toString(), names: { 0: 'src', 1: 'dst', 2: 'tmp' } },
      { id: 'gen-scatter', title: 'multiply by a constant', about: 'Emitter.scatter(0, [[1, 7]]): cell 1 gets 7 times cell 0, and cell 0 is used up. One flat loop, so an optimising interpreter does it in one step.', code: E().add(0, 6).scatter(0, [[1, 7]]).toString(), names: { 0: 'x', 1: '7 × x' } },
      { id: 'gen-mulkeep', title: 'multiply by a constant and keep the input', about: 'Emitter.addMulConst(0, 1, 7, 2): as above, but cell 0 is restored through cell 2.', code: E().add(0, 6).addMulConst(0, 1, 7, 2).toString(), names: { 0: 'x', 1: 'acc', 2: 'tmp' } },
      { id: 'gen-const', title: 'a big constant', about: 'Emitter.addConst(0, 200, 1): 200 as 14 times 14 plus 4, about 2 × √n characters instead of n.', code: E().addConst(0, 200, 1).toString() },
      { id: 'gen-mul', title: 'multiply two variables', about: 'Emitter.addMul(0, 1, 2, [3, 4]): cell 2 gets cell 0 times cell 1; both are kept.', code: E().add(0, 6).add(1, 7).addMul(0, 1, 2, [3, 4]).toString(), names: { 0: 'a', 1: 'b', 2: 'a × b' } },
      { id: 'gen-ifzero', title: 'if zero', about: 'Emitter.whenZero(0, [1, 2, 3], body): cell 0 is zero here, so the body runs and puts 9 in cell 4.', code: (() => { const e = E(); return e.whenZero(0, [1, 2, 3], () => e.add(4, 9)).toString(); })(), names: { 3: 'flag', 4: 'result' } },
      { id: 'gen-satsub', title: 'subtract without going below zero', about: 'Emitter.satSub(0, 8, [1, 2, 3]): 5 minus 8 stops at 0 instead of wrapping round to 253.', code: E().add(0, 5).satSub(0, 8, [1, 2, 3]).toString() },
    ];
    if (Patterns) {
      const peel = (bits, value) => {
        const p = new Patterns(bits === 32 ? 32 : 16); p.B = bits;           // as learn/core.js does: the same code for a width of 8
        if (bits === 8) p.add(0, value); else p.addBig(0, value, [1, 2]);
        p.peel(0, { m: bits, onSet: (j) => p.add(7 + j, 1) }, { Zo: 1, T: 2, H: [3, 4], K: 5, Kt: 6 });
        const names = { 0: 'number' };
        for (let j = 0; j < bits; j++) names[7 + j] = 'bit ' + j;
        return { code: p.toString(), names };
      };
      items.push(Object.assign({ id: 'gen-peel8', title: 'the bit peel, 8 bits', about: 'Patterns.peel: reads the binary digits of 181 (10110101) into cells 7 to 14, lowest bit first, with about four steps a bit. It depends on 8-bit wrapping cells.', settings: { bits: 8, overflow: 'wrap' } }, peel(8, 181)));
      items.push(Object.assign({ id: 'gen-peel16', title: 'the bit peel, 16 bits', about: 'The same for 40,000 on 16-bit cells: sixteen bits in cells 7 to 22. The playground switches to 16-bit cells for it.', settings: { bits: 16, overflow: 'wrap' } }, peel(16, 40000)));
    }
    return [{ title: 'Made by this project\'s generators', about: 'Output of emit.js and patterns.js, the files that build the big programs of this site. No comments: the tools write none.', items }];
  }

  const famous = [
    { title: 'Mandelbrot set', by: 'Erik Bosman', about: 'Draws the Mandelbrot set in characters. About 11,000 commands and billions of steps: the usual speed test for an interpreter. Paste it here and use Play fast.', url: 'http://esoteric.sange.fi/brainfuck/utils/mandelbrot/' },
    { title: 'Programs by Daniel B. Cristofani', by: 'Daniel B. Cristofani', about: 'Short, famous and carefully explained: squares, a Sierpinski triangle, the game of Life, a quine, and a brainfuck interpreter written in brainfuck.', url: 'https://brainfuck.org/' },
    { title: 'Brainfuck on the Esolang wiki', by: 'many authors', about: 'The reference page of the language, with more examples, algorithms and a list of the differences between interpreters.', url: 'https://esolangs.org/wiki/Brainfuck' },
  ];

  function find(id) {
    for (const g of groups) for (const it of g.items) if (it.id === id) return it;
    return null;
  }
  return { groups, generated, famous, find };
});
