# Qwen3.5-0.8B in brainfuck

The compiler of brnfck-qwen3.5-0.8b. Qwen3.5-0.8B is the smallest model with the layers of
Qwen3.8-27B: three of every four layers are a Gated DeltaNet, a memory of fixed size, and the fourth is full
attention with an output gate. This file says how the program is built and checked, what the whole-number model
is, and how the DeltaNet layer was first tried on its own.

## The program

brnfck-qwen3.5-0.8b: Qwen3.5-0.8B in brainfuck, question in, answer out, 32-bit cells.
`node tools/build.js 0.8b` runs the four steps that make and check it (README.md, step 3), and
`node compiler/qwen3.5/program/ask.js "question"` asks it. The steps one by one, with two extra checks:

```
node compiler/qwen3.5/engine/build_real.js          # engine program, weight stream, the spec's answers (engine/out/)
node compiler/qwen3.5/engine/run_real.js 2 7        # the engine program under WebAssembly against the spec
node compiler/qwen3.5/program/build.js              # the text program: engine + tokenizer (program/out/)
node compiler/qwen3.5/program/check.js 2            # the text program against the spec
node compiler/qwen3.5/program/build_pure.js         # site/programs/brnfck-qwen3.5-0.8b.bf: one file, no data
node compiler/qwen3.5/program/verify_pure.js        # its three checks
```

| File | What it does |
|---|---|
| `engine/spec.js` | The whole model in whole numbers: the spec the program computes, bit for bit |
| `engine/check_spec.js` | The spec against `reference/float.js` (`--seq` teacher forced over `data/seq256.json`, `--ask` the test questions) |
| `engine/gen.js` | The engine: the building blocks of the Qwen2.5 engine, layers in groups (lin lin lin att), a token mixer per kind |
| `engine/mixers/deltanet.js`, `attention.js` | The Gated DeltaNet and the gated full attention in brainfuck |
| `engine/normvec.js` | The normalisation of one head (L2 of q and k, rms of the DeltaNet output and of attention q and k) |
| `engine/check_engine.js`, `check_lin.js`, `check_att.js`, `check_normvec.js` | The engine against the spec on small synthetic models (`synth.js`), stage by stage, under `bfrun.js` |
| `tokenizer/` | The tokenizer of Qwen3.5 in brainfuck: `gen.js` sets the options of `compiler/qwen/tokenizer/gen.js` (`check.js`: 1019 checks) |
| `program/` | The text program, the single file and its checks |

The spec against the float model (`check_spec.js --seq`, 225 answer positions, teacher forced):

| weights | same next token | mean KL |
|---:|---:|---:|
| 8 bits (`check_spec.js --seq '{"weightBits":8}'`) | 209 of 225 (92.9%) | 0.0182 nats |
| **10 bits** (the program) | **214 of 225 (95.1%)** | **0.0048 nats** |

The spec answers "What is the capital of France?" with the float model's words: "The capital of France is **Paris**.
Located in the heart of the country, Paris is the largest city in France and serves as the seat of".

The spec's DeltaNet is that of the proof of concept below (`reference/deltanet.js`), with these changes: the weights have 10 bits instead of 8, D is folded into St by the power of two that brings it back to 1/2 .. 1 (St = round(St / 2^m)),
D has 11 bits, and roundings that cannot overflow take their bits modulo 2^n instead of clamping. No position starts from
the float model: the residual stays below 8.4 at every position, the first one too.

`brnfck-qwen3.5-0.8b.bf`, checked by `verify_pure.js`:

| | |
|---|---|
| characters | 7,709,034,855 (7.18 GiB): writing part 7,448,657,450, rest 260,377,405 |
| tape | 1,067,424,772 cells of 32 bits (3.98 GiB, fits a 32-bit WebAssembly memory) |
| memory to run | 4.9 GiB (peak of `verify_pure.js`) |
| start-up | 103 s (the file streamed in 99 s) |
| speed | 5.6 s per word piece (median; prompt positions 6.3 s each) |

| check | result |
|---|---|
| 1 only the eight commands, the brackets match, one `,` and one `.`, none in the writing part, SHA-256 | ok |
| 2 the tape after the writing part equals the tape the load part leaves after reading the 2,019,291,948 data bytes (1018 SHA-256 sums), pointer on the same cell | ok |
| 3 "What is the capital of France?": the printed text is the spec's, 30 word pieces | ok |

The engine program with its data files (`run_real.js`) gives the spec's ids on "What is the capital of France?" (30 of 30) and
"Hello" (11 of 11, "Hello! How can I help you today? 😊", then the end of the turn).

## The model

Qwen3.5-0.8B is the smallest model with `model_type` `qwen3_5`. It has the same layer types as Qwen3.8-27B.

| | Qwen3.5-0.8B | Qwen3.8-27B |
|---|---|---|
| hidden size, layers | 1024, 24 | 5120, 64 |
| DeltaNet layers (3 of every 4) | 18 | 48 |
| DeltaNet key heads / value heads of 128 | 16 / 16 | 16 / 48 |
| state per DeltaNet layer (32-bit cells) | 262,144 | 786,432 |
| full attention: query / key-value heads of 256 | 8 / 2 | 24 / 4 |
| output layer | tied to the embedding | own `lm_head` |

The vocabulary (248,320), the rotation (theta 1e7, the first 64 of 256 numbers) and the norms are the
same. `float.js` reads an untied `lm_head` when there is one, and lets value head h read key head
h / (nv / nk). Both paths are only exercised by models that have them.

## Float reference

Read from the Hugging Face code (`modeling_qwen3_5.py`) and checked against the stored weights:

- Every RMSNorm scales by (1 + w): input, post-attention, final, and the q and k norms of full attention.
  The stored gains lie around 0 (1 + w is 0.51 .. 2.47).
- The gated norm after the DeltaNet scales by w itself (0.35 .. 1.19), times silu(z).
- `q_proj` gives per head 256 query rows, then 256 output-gate rows. The gate is sigmoid(gate) times the attention output.
- The rotation turns number f with number f + 32 of the first 64 numbers of a head (rotate-half, not adjacent pairs).
  For text the three mrope sections hold the same position, so it is the ordinary rotation.
- DeltaNet: `in_proj_qkv` (q, k, v), a causal depthwise convolution over 4 tokens without bias, silu,
  L2 norm of q and k per head, q times 1/sqrt(128); decay = exp(-exp(A_log) * softplus(a + dt_bias)), beta = sigmoid(b);
  per value head S = decay * S, S += k (beta (v - S^T k))^T, out = S^T q. `A_log` and the gated norm are stored as F32.
- Chat: no system message, and `<think>\n\n</think>\n\n` after `<|im_start|>assistant\n` (thinking off, the template's default).

Greedy answers of `float.js` (60 tokens at most):

> **What is the capital of France?** The capital of France is **Paris**. Located in the heart of the country, Paris is the largest city in France and serves as the seat of the French government, the National Assembly, and the President of the Republic.

> **What is pi?** **Pi ($\pi$)** is a mathematical constant that represents the ratio of a circle's circumference to its diameter. It is an irrational number, meaning it cannot be expressed exactly as a simple fraction and has an infinite, non-repeating decimal expansion. ...

> **Wat is de hoofdstad van Nederland?** De hoofdstad van Nederland is **Amsterdam**. Amsterdam is de grootste stad in Nederland, gelegen in de provincie Noord-Holland. ...

> **Name three primary colors.** The three primary colors of light are **Red**, **Green**, and **Blue**. ...

## Files of the reference and the proof of concept

| File | What it does |
|---|---|
| `reference/float.js` | Float reference of the text model of Qwen3.5 / Qwen3.8 (`model_type` `qwen3_5`) |
| `reference/sequence.js` | Writes `data/seq256.json`: a question and the model's own answer, 256 tokens |
| `reference/deltanet.js` | One Gated DeltaNet layer in whole numbers: 32-bit wrapping cells, fixed-point tables |
| `reference/drift.js` | Runs the whole-number layers against the float reference and prints the tables below |
| `compare/record.js`, `record-parts.js`, `shapes.js` | The data of the page `site/compare/`: the state of every DeltaNet head over three answers, one answer's parts, the shapes of the four models |
| `../../site/compare/live/` | The model in the browser, on the page `site/compare/`: on all threads, with the DeltaNet layers in floats or whole numbers and a live map of their state. `node tools/site-qwen3.5.js` copies `reference/float.js` and `reference/deltanet.js` there |

```
mkdir -p compiler/downloads/qwen3.5-0.8b
cd compiler/downloads/qwen3.5-0.8b
curl -L -O https://huggingface.co/Qwen/Qwen3.5-0.8B/resolve/main/config.json
curl -L -O https://huggingface.co/Qwen/Qwen3.5-0.8B/resolve/main/tokenizer.json
curl -L -O https://huggingface.co/Qwen/Qwen3.5-0.8B/resolve/main/tokenizer_config.json
curl -L -o model.safetensors https://huggingface.co/Qwen/Qwen3.5-0.8B/resolve/main/model.safetensors-00001-of-00001.safetensors
cd ../../..
node compiler/qwen3.5/reference/float.js "What is the capital of France?"
node compiler/qwen3.5/reference/drift.js            # per layer, default bit widths (first run: 2 minutes of float capture)
node compiler/qwen3.5/reference/drift.js --sweep    # other bit widths
node compiler/qwen3.5/reference/drift.js --e2e      # all 18 DeltaNet layers in whole numbers inside the float model
node tools/site-qwen3.5.js                # copies float.js and deltanet.js to the site (README.md, step 5)
```

## The proof of concept

Before the program, one Gated DeltaNet layer was put in whole numbers on its own (`reference/deltanet.js`, 8-bit weights)
and measured against the float model. The sections below are that measurement. The program's spec changed a few things
(see "The program"); its own numbers are in that section.

### The whole-number layer

As in `compiler/qwen/engine/spec.js`, every value is an integer with a fixed number of fraction bits. Every product
and sum fits a wrapping 32-bit cell, and every function is a table. Weights are 8 bits with a power-of-two scale per row.

- **The state is S = D · St**: integers St and one scale D per head. The decay multiplies only D. When D falls below 1/2
  it is multiplied into St once and set back to 1 (here once every 2 to 16 tokens per head, averaged over a layer). Decays in this
  model run from 0.00009 to 0.9999999998 per token. Multiplied into St every token, a decay that close to 1 rounds
  small entries back to themselves for ever. That is the "decay multiplied into St" row below: its error grows over the 256 tokens.
- New values are written at the scale of St (v / D, with 1/D from a 1,025-entry table), and the query is
  multiplied by D before it reads the state. Writes and reads cost no extra multiplications per state entry.
- Multiplying St by D at renormalisation is a long multiplication over two cells (St split at 12 bits), so D keeps all its bits.
- decay = exp(-exp(λ)), λ = A_log + log softplus(a + dt_bias): one table of log softplus (4,096 entries) and one of
  exp(-exp(λ)) (832 entries), shared by all heads. A_log is a constant per head that is added.
- sigmoid: one table (8,192 entries) for beta, for silu(x) = x · sigmoid(x) after the convolution, and for silu(z).
  Beyond ±16 silu is x or 0, so the product x · sigmoid(x) never exceeds 31 bits.
- L2 norm of q and k and the RMS norm of the output: the normalisation of `spec.js` (shift so that Σ|w| < 2^19, a table of 1/sqrt
  indexed by the top 12 bits of Σw²), with the eps of the norm added at the scale of the sum. The output of a head is often
  far below sqrt(eps) = 0.001 (down to 1e-6). The shift must then stop where eps still fits, or such a head would be
  blown up to full size.

### Error over 256 tokens

`drift.js` gives each DeltaNet layer the float model's own input for every token of `data/seq256.json`. It compares
the layer's output (relative error ‖out − ref‖ / ‖ref‖ per token) and its whole state at tokens 15, 63, 127 and 255
with the float layer. Default bit widths, 8-bit weights:

| layer | output error, mean | max | last 64 tokens | state @15 | @63 | @127 | @255 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 4.52% | 5.46% | 4.64% | 1.54% | 1.79% | 1.79% | 1.83% |
| 1 | 4.58% | 8.66% | 4.62% | 2.41% | 2.36% | 2.32% | 2.12% |
| 2 | 4.72% | 7.36% | 4.89% | 1.58% | 1.50% | 1.63% | 1.68% |
| 4 | 5.30% | 8.50% | 5.28% | 1.42% | 1.45% | 1.52% | 1.63% |
| 5 | 5.77% | 8.43% | 5.68% | 1.08% | 1.15% | 1.21% | 1.36% |
| 6 | 6.68% | 9.10% | 7.19% | 1.83% | 1.84% | 2.01% | 2.28% |
| 8 | 6.78% | 9.65% | 7.22% | 1.62% | 1.54% | 1.57% | 1.64% |
| 9 | 6.57% | 8.42% | 6.77% | 1.72% | 1.74% | 1.84% | 2.07% |
| 10 | 7.19% | 9.21% | 7.37% | 1.85% | 1.83% | 2.07% | 2.29% |
| 12 | 6.74% | 9.37% | 7.25% | 1.27% | 1.32% | 1.35% | 1.36% |
| 13 | 6.36% | 9.21% | 6.89% | 1.42% | 1.41% | 1.39% | 1.56% |
| 14 | 6.67% | 8.99% | 6.86% | 1.80% | 1.63% | 1.56% | 1.63% |
| 16 | 5.58% | 7.24% | 5.29% | 1.22% | 1.35% | 1.28% | 1.37% |
| 17 | 4.77% | 8.20% | 4.72% | 1.06% | 1.16% | 1.15% | 1.27% |
| 18 | 4.70% | 7.68% | 4.67% | 1.12% | 1.19% | 1.29% | 1.37% |
| 20 | 4.18% | 6.46% | 4.08% | 1.20% | 1.22% | 1.26% | 1.36% |
| 21 | 4.38% | 7.69% | 4.27% | 1.17% | 1.30% | 1.34% | 1.36% |
| 22 | 4.33% | 6.03% | 4.11% | 1.20% | 1.36% | 1.39% | 1.51% |
| **all** | **5.55%** | | **5.66%** | | | | **1.65%** |

Mean output error per 32 tokens: 5.42%, 5.44%, 5.61%, 5.56%, 5.46%, 5.57%, 5.65%, 5.66%. No product or sum
leaves 31 bits and no rounding clamps. The state error is reached in the first 16 tokens and stays there:
the delta rule writes the difference between the value and what the state predicts, so it corrects its own rounding.

### Bit widths

Mean over the 18 layers. Each row changes the default only where it says.

| setting | output error | worst layer | last 64 tokens | state @255 | worst layer |
|---|---:|---:|---:|---:|---:|
| **default** | **5.55%** | 7.19% | 5.66% | 1.65% | 2.29% |
| decay multiplied into St every token (DB 15) | 10.31% | 19.67% | 14.95% | 1.72% | 2.49% |
| weights 10 bits | 3.25% | 5.27% | 3.42% | 1.09% | 1.74% |
| weights 12 bits | 2.99% | 5.09% | 3.17% | 1.04% | 1.71% |
| state SB 15, keys KB 10 | 5.82% | 8.10% | 6.02% | 1.61% | 2.27% |
| state SB 14, keys KB 11 | 6.74% | 10.76% | 7.23% | 1.64% | 2.34% |
| state SB 13, keys KB 12 | 8.83% | 16.15% | 9.80% | 1.79% | 2.57% |
| after the convolution CB 10 | 7.14% | 12.07% | 7.45% | 2.16% | 4.12% |
| queries QB 12 | 6.30% | 8.29% | 6.49% | 1.65% | 2.29% |
| output of the state OB 16 | 7.87% | 13.89% | 7.98% | 1.65% | 2.29% |
| out_proj input HB 8 | 5.97% | 7.88% | 6.05% | 1.65% | 2.29% |
| decay and D at DB 10 | 5.55% | 7.20% | 5.67% | 1.77% | 2.32% |
| log decay LB 4, AB 4 | 5.57% | 7.23% | 5.67% | 1.89% | 2.53% |
| beta TB 6 | 5.56% | 7.22% | 5.66% | 1.72% | 2.44% |

The widths that keep it accurate (the defaults of `deltanet.js`; "fraction bits / total bits"):

| value | bits | why |
|---|---|---|
| weights | 8 (10 halves the error) | the largest single source of error |
| state St, values, deltas | 16 / 24 | each step down doubles the output error; St · key must fit: SB + KB ≤ 25 |
| unit keys | 9 | |
| queries (length 1/sqrt(128)) | 14 | St · query must fit: SB + QB ≤ 30 |
| after the convolution | 13 / 21 | queries and keys are often near 0.05, and only their direction counts |
| output of the state | 19 / 20 | heads with an output near 1e-5 still matter |
| decay and D | 12 | 10 is as good |
| log decay λ, a + dt_bias | 6, 6 | 4 is as good |
| beta | 7 | 6 is as good; delta · beta must fit: SB + TB ≤ 23 |
| input of out_proj | 10 / 18 | |

### All DeltaNet layers in the float model

All 18 DeltaNet layers in whole numbers (default widths, 8-bit weights) inside the float model, with the full
attention, feed-forward and output layers in floats. Same 256 tokens, teacher forced: is the next token the same?

| weights | same next token | mean KL(float ‖ whole numbers) |
|---|---:|---:|
| 8 bits | 218 of 225 (96.9%) | 0.0045 nats |
| 10 bits | 222 of 225 (98.7%) | 0.0012 nats |

Greedy answers with all DeltaNet layers in whole numbers (8-bit weights, 40 tokens). The first sentences are the same
as the float model's. Later on a few words differ (marked):

> **What is the capital of France?** The capital of France is **Paris**. Located in the heart of the country, Paris is the largest city in France and serves as the seat of the French government, the *Parliament of France*, and

> **What is pi?** **Pi ($pi$)** is a mathematical constant that represents the ratio of a circle's circumference to its diameter. It is an irrational number, meaning it cannot be expressed exactly as a simple fraction

> **Wat is de hoofdstad van Nederland?** De hoofdstad van Nederland is **Amsterdam**. Amsterdam is de grootste stad in Nederland, gelegen in de provincie Noord-Holland. Het stadsdeel heeft een enorme economische*,*

> **Name three primary colors.** The three primary colors of light are **Red**, **Green**, and **Blue**. These are the colors that*, when mixed together without any other color present, create the full spectrum* of visible light

With 10-bit weights the first three answers match the float model word for word up to the last word or two.

## For Qwen3.8-27B

- The layer is the same; only the head counts differ (48 value heads read 16 key heads, three each). St is
  786,432 cells per layer and 37.7 million for its 48 DeltaNet layers, whatever the length of the conversation.
  The full attention layers need 32,768 cells of keys and values per token.
- The bit widths above come from the ranges of the 0.8B model (|state| ≤ 14.3, |v| ≤ 19.4, |q|, |k| ≤ 82 before their norm,
  decay 0.00009 .. 1). The 27B model needs its own ranges before its widths are fixed: `drift.js` reports a clamp or an
  overflow when one of them is too narrow.
- Weights are the largest error here. 10 bits instead of 8 brings the layer from 5.5% to 3.3%.
