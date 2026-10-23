// The sections of the engine of each program: their names, what they do, and their colour family.
// Shared by the pages inside/, map/ and about/ (through core.js) and by the home page.
(function () {
  'use strict';
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const secSmall = () => ({
    ask: { fam: 'text', group: 'Before the first word piece', name: 'Read the question, cut it into word pieces', desc: 'Reads the letters of the question with the one input command. Looks every letter up, marks where words start, and joins letters into word pieces by looking pairs up in the vocabulary table. It walks to a table record with long and short hops and finds the way back without counting.' },
    queue: { fam: 'text', group: 'Before the first word piece', name: 'Line up the pieces', desc: 'Throws away the word pieces of the fixed opening lines (their results are already in memory) and sets the counters for how many positions may still run.' },
    take: { fam: 'text', group: 'For every word piece', name: 'Take the next piece', desc: 'If the question still has pieces left, the next one becomes the current piece. Otherwise the piece chosen last time is used.' },
    emb: { fam: 'emb', group: 'For every word piece', name: 'Fetch the piece\'s row of 576 numbers', desc: 'The table of word pieces lies on the tape as 576 long strips. Every strip is moved across a gap; a counter runs along and picks out the cell that belongs to this word piece. The 576 cells picked out are the running numbers the layers work on.' },
    xn1: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Scale the numbers', desc: 'Brings the 576 running numbers to a common size before they are used: add up their sizes, count the bits of the total, look up one over the square root in a table of 4,096 entries, and multiply.' },
    sweep1: { fam: 'att', group: 'In each of the 30 layers', name: 'Weights × numbers: question, key, value', desc: 'The first matrix of the layer: 960 rows and 576 columns. For every running number its column of weights crosses the gap and is added to 960 totals.' },
    qkv: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Round the totals', desc: 'Divides the 960 totals by a power of two, rounds them and keeps them within limits. The result: the question (576 numbers), the key and the value (192 each).' },
    rot: { fam: 'att', group: 'In each of the 30 layers', name: 'Turn by position', desc: 'Turns pairs of numbers of the question and the key by an angle that depends on the position of the word piece. Sines and cosines come from a table. This is how the model knows which piece came before which.' },
    store: { fam: 'mem', group: 'In each of the 30 layers', name: 'Store key and value', desc: 'Walks to the memory slot of this position and leaves the key and the value there. They stay for the rest of the conversation.' },
    att: { fam: 'mem', group: 'In each of the 30 layers', name: 'Look back at every earlier piece', desc: 'Walks past every filled slot with the question in hand. In each slot: multiply question and key into a score, look up the exponential of the score in a table of 256 entries, and add the value, times that result, to running sums.' },
    mixed: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Divide by the total', desc: 'Divides the sums by the total of all scores (one over the total comes from a table of 1,024 entries) and rounds.' },
    hop: { fam: 'work', group: 'In each of the 30 layers', name: 'Carry everything across the slots', desc: 'The next matrix lies on the other side of the 256 memory slots. One loop carries 1,165 cells across, a distance of about 748,000 cells.' },
    sweep2: { fam: 'att2', group: 'In each of the 30 layers', name: 'Weights × numbers: attention output', desc: 'The second matrix: 576 rows and 576 columns.' },
    xatt: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Add to the running numbers', desc: 'Rounds the totals and adds them to the running numbers.' },
    xn2: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Scale the numbers again', desc: 'The same scaling as at the start of the layer, now before the feed-forward part.' },
    sweep3: { fam: 'ff', group: 'In each of the 30 layers', name: 'Weights × numbers: widen to 3,072', desc: 'The largest matrix of the layer: 3,072 rows and 576 columns. This is where most of the steps go.' },
    hid: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Bend and multiply in pairs', desc: 'The 3,072 totals are two sets of 1,536. One set goes through a bent curve, looked up in a table of 4,096 entries. Then the two sets are multiplied, pair by pair.' },
    sweep4: { fam: 'ff2', group: 'In each of the 30 layers', name: 'Weights × numbers: back to 576', desc: 'The last matrix of the layer: 576 rows and 1,536 columns.' },
    xout: { fam: 'tidy', group: 'In each of the 30 layers', name: 'Add to the running numbers', desc: 'Rounds the totals and adds them to the running numbers. The layer is done; the loop goes round for the next one.' },
    xnf: { fam: 'tidy', group: 'After the last layer', name: 'Scale the numbers one last time', desc: 'The same scaling, before the output table.' },
    cls: { fam: 'out', group: 'After the last layer', name: 'A score for every word piece; keep the highest', desc: 'The output table is cut into 16 parts of 3,072 rows. One piece of code runs 16 times. After each part the best score so far and its number travel on, so at the end the winner is known.' },
    return: { fam: 'work', group: 'After the last layer', name: 'Walk home, put every column back', desc: 'The pointer is at the far left of the tape and every column of weights lies one gap further than where it started. This walk moves them all back and ends where it began.' },
    print: { fam: 'text', group: 'After the last layer', name: 'End piece? Otherwise print', desc: 'If the chosen piece is one of the two "end" pieces, the program stops. Otherwise it walks to the piece\'s record in the vocabulary table and prints its letters with the one output command.' },
  });
  const secQwen = (E) => {
    const m = E.model, M = E.matrices, lay = E.layout, T = m.tables, n = fmt, A = 'Before the first word piece', P = 'For every word piece', L = 'In each of the ' + m.layers + ' layers', Z = 'After the last layer';
    const rc = (x) => n(x.rows) + ' rows and ' + n(x.cols) + ' columns';
    return {
      ask: { fam: 'text', group: A, name: 'Read the question, cut it into word pieces', desc: 'Reads the bytes of the question with the one input command, at most ' + lay.maxQuestion + '. Looks every byte up in a table that gives its word piece and its kind: letter, digit, space and so on. Cuts the text into words by the rules of this vocabulary. Then it joins pieces: every pair of neighbours is looked up in a table of ' + n(lay.tokRecords) + ' records, and the pair whose result has the lowest number is joined first. A record is reached with long hops of ' + n(lay.tokLongHop) + ' cells, short hops of ' + lay.tokBlock + ' cells and a choice out of ' + lay.tokHop + '.' },
      queue: { fam: 'text', group: A, name: 'Line up the pieces', desc: 'Throws away the word pieces of the fixed opening lines (their results are already in memory) and sets the counters for how many positions may still run.' },
      take: { fam: 'text', group: P, name: 'Take the next piece', desc: 'If the question still has pieces left, the next one becomes the current piece. Otherwise the piece chosen last time is used.' },
      emb: { fam: 'emb', group: P, name: 'Fetch the piece\'s row of ' + n(m.dim) + ' numbers', desc: 'The table of word pieces lies on the tape as ' + n(m.dim) + ' long strips of ' + n(m.vocab) + ' cells. Every strip is moved across a gap; a counter runs along and picks out the cell that belongs to this word piece. The ' + n(m.dim) + ' cells picked out are brought to the scale of the running numbers and laid down as a strip in front of the first layer.' },
      xn1: { fam: 'tidy', group: L, name: 'Scale the numbers, times a gain', desc: 'Brings the ' + n(m.dim) + ' running numbers to a common size: add up their sizes, count the bits of the total, add up the squares, look up one over the square root in a table of ' + n(T.inv) + ' entries, and multiply. Then every number is multiplied by its own gain, from a strip of ' + n(m.dim) + ' constants, and rounded. The numbers as they were ride along with the next matrix as a strip: they are needed again after it.' },
      sweep1: { fam: 'att', group: L, name: 'Weights × numbers: question, key, value', desc: 'The first matrix of the layer: ' + rc(M.qkv) + '. For every running number its column of weights crosses the gap and is added to ' + n(M.qkv.rows) + ' totals.' },
      qkv: { fam: 'tidy', group: L, name: 'Scale each row, add the bias, round', desc: 'Every one of the ' + n(M.qkv.rows) + ' totals is doubled as often as the scale of its row says, gets the bias of its row added, and is divided by a power of two, rounded and kept within limits. Scales and biases come from two strips of constants. The result: the question (' + n(m.dim) + ' numbers), the key and the value (' + n(m.kv) + ' each).' },
      rot: { fam: 'att', group: L, name: 'Turn by position', desc: 'Turns pairs of numbers of the question and the key by an angle that depends on the position of the word piece. Sines and cosines come from a table. This is how the model knows which piece came before which.' },
      store: { fam: 'mem', group: L, name: 'Store key and value', desc: 'Walks to the memory slot of this position and leaves the key and the value there. They stay for the rest of the conversation.' },
      att: { fam: 'mem', group: L, name: 'Look back at every earlier piece', desc: 'Walks past every filled slot with the question in hand, and back again. On the way out each slot multiplies its key with the question, into one score for each of the ' + m.heads + ' heads; ' + m.share + ' heads share one key. The highest score of every head travels along. On the way back each slot takes how far its score lies below the highest, looks up the exponential of that in a table of ' + n(T.exp) + ' entries, and adds its value, times the result, to running sums.' },
      mixed: { fam: 'tidy', group: L, name: 'Divide by the total', desc: 'Divides the sums of every head by the total of its weights (one over the total comes from a table of ' + n(T.recip) + ' entries) and rounds. The result is laid ready for the next matrix, next to the running numbers that came along.' },
      hop: { fam: 'work', group: L, name: 'Carry everything across the slots', desc: 'The next matrix lies on the other side of the ' + m.maxTokens + ' memory slots. One loop carries ' + n(E.hop.cells) + ' cells across, a distance of about ' + n(Math.round(E.hop.longest / 1000) * 1000) + ' cells.' },
      sweep2: { fam: 'att2', group: L, name: 'Weights × numbers: attention output', desc: 'The second matrix: ' + rc(M.o) + '. The running numbers ride through it as a strip.' },
      xatt: { fam: 'tidy', group: L, name: 'Scale each row, add the running numbers', desc: 'Every total is doubled as often as the scale of its row says. The running number that came along is added, and the sum is rounded. That is the new running number.' },
      xn2: { fam: 'tidy', group: L, name: 'Scale the numbers again, times a gain', desc: 'The same scaling as at the start of the layer, with a gain strip of its own, now before the feed-forward part.' },
      sweep3: { fam: 'ff', group: L, name: 'Weights × numbers: widen to ' + n(M.w13.rows), desc: 'The largest matrix of the layer: ' + rc(M.w13) + '. This is where most of the steps go.' },
      hid: { fam: 'tidy', group: L, name: 'Bend and multiply in pairs', desc: 'The ' + n(M.w13.rows) + ' totals are two sets of ' + n(m.hidden) + '. Each total is doubled as the scale of its row says, and rounded. One set goes through a bent curve, looked up in a table of ' + n(T.silu) + ' entries. Then the two sets are multiplied, pair by pair.' },
      sweep4: { fam: 'ff2', group: L, name: 'Weights × numbers: back to ' + n(m.dim), desc: 'The last matrix of the layer: ' + rc(M.w2) + '. The running numbers ride through it as a strip.' },
      xout: { fam: 'tidy', group: L, name: 'Scale each row, add the running numbers', desc: 'As after the attention output: double, add the running number that came along, round. The layer is done; the loop goes round for the next one.' },
      xnf: { fam: 'tidy', group: Z, name: 'Scale the numbers one last time', desc: 'The same scaling and gain, before the output table.' },
      cls: { fam: 'out', group: Z, name: 'A score for every word piece; keep the highest', desc: 'The output table is the table of word pieces once more, cut into ' + m.chunks + ' parts of ' + n(m.chunk) + ' rows. One piece of code runs ' + m.chunks + ' times. After each part the best score so far and its number travel on, so at the end the winner is known.' },
      return: { fam: 'work', group: Z, name: 'Walk home, put every column back', desc: 'The pointer is at the far left of the tape and every column of weights lies one gap further than where it started. This walk moves them all back and ends where it began.' },
      print: { fam: 'text', group: Z, name: 'End piece? Otherwise print', desc: 'If the chosen piece is one of the two "end" pieces, the program stops. Otherwise it walks to the piece\'s record in the vocabulary table. The record says: this piece is one byte, or it is two smaller pieces. The program follows those rules down, with a small stack, and prints the bytes with the one output command.' },
    };
  };
  // Qwen3.5 (brnfck-qwen3.5-0.8b): groups of three DeltaNet layers and one attention layer, each place written once and run
  // six times by a loop. Section u0.xn1 gets the entry of xn1, its layers as group; step counts are by name.
  const secQwen35 = (E) => {
    const m = E.model, M = E.matrices, lay = E.layout, T = m.tables, D = m.deltanet, n = fmt, base = secQwen(E);
    const nLin = m.types.filter((t) => t === 'lin').length, nAtt = m.layers - nLin, g = m.groups, per = m.unit.length;
    const A = 'Before the first word piece', P = 'For every word piece', L = 'In each of the ' + m.layers + ' layers', DL = 'In each of the ' + nLin + ' DeltaNet layers', AL = 'In each of the ' + nAtt + ' attention layers', Z = 'After the last layer';
    const rc = (x) => n(x.rows) + ' rows and ' + n(x.cols) + ' columns';
    const S = {
      ask: { ...base.ask, group: A },
      queue: { fam: 'text', group: A, name: 'Count the pieces', desc: 'Hands the number of word pieces of the question to the counters of the engine and sets how many positions may still run: ' + m.maxTokens + '. Nothing is in memory yet: this program has no opening lines worked out beforehand, so every word piece of the question goes through the model, from the first one on.' },
      take: { ...base.take, group: P, desc: 'If the question still has pieces left, the next one becomes the current piece. Otherwise the piece chosen last time is used.' },
      emb: { ...base.emb, group: P },
      xn1: { ...base.xn1, group: L },
      'dn.sweep1': { fam: 'dn', group: DL, name: 'Weights × numbers: the DeltaNet input', desc: 'The first matrix of a DeltaNet layer: ' + rc(M.lin) + '. Its rows make, for this word piece, ' + n(D.keyDim) + ' numbers for the queries, ' + n(D.keyDim) + ' for the keys, ' + n(D.valueDim) + ' for the values, ' + n(D.valueDim) + ' for a gate at the end, and two numbers for each of the ' + D.valueHeads + ' heads: how much it forgets, and how strongly it writes.' },
      'dn.round': { fam: 'tidy', group: DL, name: 'Scale each row, round', desc: 'Every one of the ' + n(M.lin.rows) + ' totals is doubled as often as the scale of its row says, then divided by a power of two, rounded and kept within limits. The scales come from a strip of constants.' },
      'dn.conv': { fam: 'dn', group: DL, name: 'Mix with the three word pieces before', desc: 'A short convolution. Each of the ' + n(D.convDim) + ' numbers for the queries, keys and values is added to the same number of the last ' + (D.kernel - 1) + ' word pieces, each times a weight of its own (' + n(D.kernel * D.convDim) + ' weights), and bent by a curve from a table of ' + n(T.sig) + ' entries. The numbers of the last ' + (D.kernel - 1) + ' word pieces stay on the tape between word pieces: ' + n((D.kernel - 1) * D.convDim) + ' cells.' },
      'dn.qk': { fam: 'tidy', group: DL, name: 'Queries and keys to a fixed length', desc: 'Every query and every key of ' + D.keySize + ' numbers is scaled to a fixed length: one over the square root of ' + D.keySize + ' for a query, one for a key.' },
      'dn.load': { fam: 'work', group: DL, name: 'Load the heads\' conveyor', desc: 'The values, and two constants for every head, are laid on a conveyor: a strip of cells that travels through the ' + D.valueHeads + ' heads, one head further each round, with the queries, the keys and the running numbers on it.' },
      'dn.decay': { fam: 'mem', group: DL, name: 'Fade the table', desc: 'How much this head forgets of the past, looked up in two tables (' + n(T.lsp) + ' and ' + n(T.dec) + ' entries): a number a little below one. The ' + n(D.keySize * D.valueSize) + ' numbers of the head\'s table are not all multiplied by it. One scale number of the head is, and only when that scale drops below a half are all numbers of the table halved, as often as needed.' },
      'dn.vq': { fam: 'tidy', group: DL, name: 'Value and query to the scale of the table', desc: 'The value is divided by the scale of the table (one over the scale from a table of ' + n(T.recipD) + ' entries) and the query multiplied by it, so that both fit the numbers as they lie in the table.' },
      'dn.predict': { fam: 'mem', group: DL, name: 'What the table says for the key', desc: 'A pass over the ' + D.keySize + ' columns of the table. Each column of ' + D.valueSize + ' numbers is added once for every bit of its number of the key: the table times the key, which is what the table remembers for it.' },
      'dn.delta': { fam: 'tidy', group: DL, name: 'The difference, times the strength', desc: 'The value minus what the table already says for the key, times how strongly this head writes: ' + D.valueSize + ' numbers.' },
      'dn.write': { fam: 'mem', group: DL, name: 'Write the difference into the table', desc: 'A second pass over the ' + D.keySize + ' columns: every column gets the difference times its number of the key added. All ' + n(D.keySize * D.valueSize) + ' numbers of the table change. That is all this layer keeps of the word piece.' },
      'dn.read': { fam: 'mem', group: DL, name: 'Read the table with the query', desc: 'A third pass over the columns, now with the query: the table times the query gives the ' + D.valueSize + ' numbers this head hands on.' },
      'dn.next': { fam: 'work', group: DL, name: 'On to the next head', desc: 'The conveyor moves on by one head, ' + n(D.headCells) + ' cells: the inputs of the heads still to come, the outputs of the heads so far, the running numbers and the gate. The same code then runs for the next head.' },
      'dn.gated': { fam: 'tidy', group: DL, name: 'Scale every head, times a gain and the gate', desc: 'After the last head: the ' + D.valueSize + ' numbers of every head are brought to a common size, multiplied by a gain, and by the gate made at the start, bent by a curve. The result is laid ready for the next matrix.' },
      'dn.sweep2': { fam: 'dn2', group: DL, name: 'Weights × numbers: the DeltaNet output', desc: 'The second matrix of a DeltaNet layer: ' + rc(M.lino) + '. The running numbers ride through it as a strip.' },
      'dn.xatt': { fam: 'tidy', group: DL, name: 'Scale each row, add the running numbers', desc: 'Every total is doubled as often as the scale of its row says. The running number that came along is added, and the sum is rounded.' },
      sweep1: { fam: 'att', group: AL, name: 'Weights × numbers: question, key, gate, value', desc: 'The first matrix of an attention layer: ' + rc(M.qkv) + '. Its rows make the question (' + n(m.qDim) + ' numbers), the key (' + n(m.kv) + '), a gate for the question (' + n(m.qDim) + ') and the value (' + n(m.kv) + ').' },
      qkv: { fam: 'tidy', group: AL, name: 'Scale each row, round', desc: 'Every one of the ' + n(M.qkv.rows) + ' totals is doubled as often as the scale of its row says, then divided by a power of two, rounded and kept within limits. There is no bias in this model.' },
      trig: { fam: 'att', group: AL, name: 'Sines and cosines of the position', desc: 'Looks up the sine and the cosine of this position for ' + m.rotDim / 2 + ' speeds of turning, in tables of ' + n(T.cos) + ' entries.' },
      heads: { fam: 'att', group: AL, name: 'Every head to a common size, turned by position', desc: 'Each of the ' + m.heads + ' question heads and ' + m.kvHeads + ' key heads of ' + m.headSize + ' numbers is brought to a common size and multiplied by a gain of its own. Then the first ' + m.rotDim + ' numbers of every head are turned in pairs by an angle that depends on the position. This is how the model knows which piece came before which.' },
      store: { ...base.store, group: AL },
      att: { fam: 'mem', group: AL, name: 'Look back at every earlier piece', desc: 'Walks past every filled slot with the question in hand, and back again. On the way out each slot multiplies its key with the question, into one score for each of the ' + m.heads + ' heads; ' + m.share + ' heads share one key. The highest score of every head travels along. On the way back each slot takes how far its score lies below the highest, looks up the exponential of that in a table of ' + n(T.exp) + ' entries, and adds its value, times the result, to running sums.' },
      mixed: { fam: 'tidy', group: AL, name: 'Divide by the total, times the gate', desc: 'Divides the sums of every head by the total of its weights (one over the total comes from a table of ' + n(T.recip) + ' entries), multiplies them by the gate, bent by a curve, and rounds.' },
      hop: { fam: 'work', group: AL, name: 'Carry everything across the slots', desc: 'The next matrix lies on the other side of the ' + m.maxTokens + ' memory slots. The numbers are carried across one slot at a time: ' + n(E.hop.cells) + ' cells.' },
      sweep2: { fam: 'att2', group: AL, name: 'Weights × numbers: attention output', desc: 'The second matrix of an attention layer: ' + rc(M.o) + '. The running numbers ride through it as a strip.' },
      xatt: { ...base.xatt, group: AL },
      xn2: { ...base.xn2, group: L },
      sweep3: { ...base.sweep3, group: L },
      hid: { ...base.hid, group: L },
      sweep4: { ...base.sweep4, group: L },
      xout: { ...base.xout, group: L, desc: 'As after the mixing part: double, add the running number that came along, round. The layer is done.' },
      xnf: { ...base.xnf, group: Z },
      cls: { ...base.cls, group: Z },
      return: { ...base.return, group: Z },
      print: { ...base.print, group: Z },
    };
    if (m.vision) {
      Object.assign(S, secVision(E));
      S.ask = { ...S.ask, desc: S.ask.desc.replace('with the one input command', 'with two input commands of its own (one for the first byte, one in a loop for the rest)') };
    }
    // the sections of the text: the entry of their name, grouped by the layers they run for
    const nth = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
    for (const s of E.sections) {
      if (!s.key || s.layerKind === 'vision') continue;
      const layers = Array.from({ length: g }, (_, i) => i * per + s.u + 1), list = layers.slice(0, -1).join(', ') + ' and ' + layers[layers.length - 1];
      S[s.id] = { ...S[s.key], group: 'The ' + nth[s.u] + ' layer of a group of ' + per + ' (' + (s.layerKind === 'lin' ? 'DeltaNet' : 'attention') + '): layers ' + list, key: s.key };
    }
    return S;
  };
  // brnfck-qwen3.5-0.8b-vision: before the question the vision part reads the squares, then runs rounds, each its own text:
  // the second half of a layer and the first half of the next. Section v3.att gets the entry of v.att, its round as group.
  const secVision = (E) => {
    const m = E.model, V = m.vision, M = V.matrices, n = fmt, R = 'The picture part, in its rounds', rc = (x) => n(x.rows) + ' rows and ' + n(x.cols) + ' columns';
    const S = {
      vstart: { fam: 'pic2', group: R, name: 'Get the picture part ready', desc: 'Marks the entries of the queue of the ' + V.squares + ' squares as waiting, and sets the count of squares for the first round.' },
      'v.read': { fam: 'text', group: R, name: 'Read a square of the picture', desc: 'Reads the next ' + n(V.squareBytes) + ' bytes of the picture with an input command of its own: the red, green and blue of the ' + V.patch * V.patch + ' pixels of one square of ' + V.patch + ' × ' + V.patch + '. The program reads the ' + V.squares + ' squares one at a time, always with this same comma.' },
      'v.position': { fam: 'pic', group: R, name: 'Fetch where the square lies', desc: 'Takes the first vector from the queue of positions that is still waiting: ' + n(V.dim) + ' numbers that say where this square lies in the picture. They are the numbers of the square to start from.' },
      'v.patch': { fam: 'pic', group: R, name: 'Weights × bytes: the square', desc: 'The weights of the squares: ' + rc(M.patch) + '. Every byte of the square crosses the gap with its column of weights and is added to ' + n(M.patch.rows) + ' totals.' },
      'v.x0': { fam: 'tidy', group: R, name: 'Add to the numbers of the square', desc: 'Rounds the totals and adds them to the numbers of the square\'s position.' },
      'v.xn1': { fam: 'tidy', group: R, name: 'Scale the numbers, times a gain', desc: 'Brings the ' + n(V.dim) + ' numbers of the square to a common size and multiplies each by its own gain, before the first matrix of the layer.' },
      'v.sweep1': { fam: 'pic', group: R, name: 'Weights × numbers: question, key, value', desc: 'The first matrix of a picture layer: ' + rc(M.qkv) + '.' },
      'v.qkv': { fam: 'tidy', group: R, name: 'Scale each row, add the bias, round', desc: 'Every total is doubled as often as the scale of its row says, gets the bias of its row, and is rounded: the question, the key and the value of the square, ' + n(V.dim) + ' numbers each.' },
      'v.rot': { fam: 'pic', group: R, name: 'Turn by row and column', desc: 'Turns pairs of numbers of the question and the key by angles that depend on the row and the column of the square in the picture. This is how the picture part knows where a square lies.' },
      'v.store': { fam: 'pic2', group: R, name: 'Store key and value in the slot of the square', desc: 'Walks to the slot of this square and leaves its key and value there, and parks its question and its numbers beside them for the next round.' },
      'v.back': { fam: 'work', group: R, name: 'Walk home, put every column back', desc: 'Back to the start of the round: every column of weights that moved one gap along goes back, and the pointer walks over the slots to where it began. Then the same text runs for the next square.' },
      'v.fetch': { fam: 'pic2', group: R, name: 'Take the next square from its slot', desc: 'Walks to the first slot whose square has not had its turn in this round, takes the question and the numbers parked there back out, and carries them to the start of the slots. A round goes over all ' + V.squares + ' squares this way.' },
      'v.att': { fam: 'pic2', group: R, name: 'Look at every square of the picture', desc: 'Walks past all ' + V.squares + ' slots with the question of this square in hand, before it and after it: every square sees every other square. For each of the ' + V.heads + ' heads a score, its exponential from a table, and the value of the slot times that, added to running sums.' },
      'v.mixed': { fam: 'tidy', group: R, name: 'Divide by the total', desc: 'Divides the sums of every head by the total of its weights and rounds.' },
      'v.hop': { fam: 'work', group: R, name: 'Carry everything across the slots', desc: 'The next matrix lies on the other side of the ' + V.squares + ' slots. The numbers are carried across.' },
      'v.sweep2': { fam: 'pic2', group: R, name: 'Weights × numbers: attention output', desc: 'The attention output matrix of a picture layer: ' + rc(M.o) + '.' },
      'v.xatt': { fam: 'tidy', group: R, name: 'Scale each row, add the bias and the numbers', desc: 'Every total is doubled as its row says, gets its bias and the number of the square that came along, and is rounded.' },
      'v.xn2': { fam: 'tidy', group: R, name: 'Scale the numbers again, times a gain', desc: 'The same scaling, with a gain of its own, before the feed-forward part.' },
      'v.sweep3': { fam: 'pic', group: R, name: 'Weights × numbers: widen to ' + n(M.w13.rows), desc: 'The widening matrix of a picture layer: ' + rc(M.w13) + '.' },
      'v.hid': { fam: 'tidy', group: R, name: 'Add the bias, bend', desc: 'Every one of the ' + n(M.w13.rows) + ' totals gets its bias and goes through a bent curve: the number times the share of a bell curve below it, from a table.' },
      'v.sweep4': { fam: 'pic2', group: R, name: 'Weights × numbers: back to ' + n(V.dim), desc: 'The last matrix of a picture layer: ' + rc(M.w2) + '.' },
      'v.xout': { fam: 'tidy', group: R, name: 'Scale each row, add the bias and the numbers', desc: 'As after the attention output. The layer is done for this square.' },
      'v.mnorm': { fam: 'tidy', group: R, name: 'Scale the square for the merger', desc: 'After the last layer: the numbers of the square are scaled, times a gain, and laid in the queue of the merger, next to the squares before it.' },
      'v.msweep1': { fam: 'pic', group: R, name: 'Merger: weights × four squares', desc: 'After every ' + V.perVector + ' squares: their ' + n(M.m1.cols) + ' numbers through the first matrix of the merger, ' + rc(M.m1) + '.' },
      'v.mgelu': { fam: 'tidy', group: R, name: 'Merger: add the bias, bend', desc: 'Every total gets its bias and goes through the same bent curve as in the layers.' },
      'v.msweep2': { fam: 'pic2', group: R, name: 'Merger: weights × numbers, to ' + n(V.out), desc: 'The last matrix of the merger: ' + rc(M.m2) + '. Its rows are as many as the numbers of a word piece of the text model.' },
      'v.mout': { fam: 'pic2', group: R, name: 'Into the queue for the text', desc: 'The ' + n(V.out) + ' totals get their bias and are rounded into the next entry of the queue of ' + V.vectors + ' vectors that the text model reads.' },
      'v.mback': { fam: 'work', group: R, name: 'Merger: put every column back', desc: 'The columns of the two matrices of the merger go back to where they started.' },
      vend: { fam: 'work', group: R, name: 'Empty the slots, walk to the question', desc: 'Clears the slots of the last layer, counts the ' + V.vectors + ' vectors in the queue, and walks the long way back from the end of the tape to the tokenizer: the picture part is done, and the question is read next.' },
    };
    const roundOf = (s) => Number(s.id.slice(1, s.id.indexOf('.'))), last = Math.max(...E.sections.filter((s) => s.layerKind === 'vision').map(roundOf));
    for (const s of E.sections) {
      if (s.layerKind !== 'vision') continue;
      const r = roundOf(s), group = r === 0 ? 'Round 1: read every square, then the first half of picture layer 1' : r === last ? 'Round ' + (r + 1) + ': the second half of picture layer ' + r + ', then the merger' : 'Round ' + (r + 1) + ': picture layer ' + r + ', second half, and picture layer ' + (r + 1) + ', first half';
      S[s.id] = { ...S[s.key], group, key: s.key, round: r };
    }
    return S;
  };
  // E: engine.json of a program
  window.EngineSections = { of: (E) => (E.family === 'smol' ? secSmall() : E.family === 'qwen3.5' ? secQwen35(E) : secQwen(E)) };
})();
