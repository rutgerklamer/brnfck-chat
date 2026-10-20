'use strict';

// Where the picture sits in a conversation of the program: right after <|im_start|>user\n<|vision_start|>, one word
// piece <|image_pad|> per four squares, then <|vision_end|>, the question and the rest of the chat template
// (reference/vision.js visionPrompt). The place of every position for the rotation of the text model follows from it,
// whatever the question: before the picture the position itself, in it (start, start + row, start + column), after it
// the position minus (the word pieces of the picture - the larger side of its grid of blocks).

function promptLayout(tok, V, sq, maxTokens = 256) {
  const before = tok.encode('<|im_start|>user\n<|vision_start|>'), k = V.merge, bh = sq.gh / k, bw = sq.gw / k, start = before.length, images = bh * bw;
  const shift = images - Math.max(bh, bw);
  const rope = Array.from({ length: maxTokens }, (_, i) => {
    if (i < start) return [i, i, i];
    if (i < start + images) { const j = i - start; return [start, start + Math.floor(j / bw), start + (j % bw)]; }
    return [i - shift, i - shift, i - shift];
  });
  return { before, start, images, rope, imageToken: V.imageToken, endIds: tok.encode('<|vision_end|>') };
}

module.exports = { promptLayout };
