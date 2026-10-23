'use strict';

// The picture in a prompt: <|im_start|>user\n<|vision_start|>, one <|image_pad|> per four squares, <|vision_end|>.
// Rope place of i: i before it, (start, start + row, start + column) in it, i - (pieces - larger grid side) after.

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
