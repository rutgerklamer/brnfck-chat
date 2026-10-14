# brnfck.chat

Type a question. A program written in brainfuck prints the answer.

Brainfuck has eight commands. They move along a row of memory cells, change the numbers in them,
and read or print characters. Here those commands run a language model. Each program is one text
file of only `+ - < > [ ] , .`, and its only input is your question.

How that works is on the site: https://brnfck.chat. This page says how to run it yourself.

## The three programs

| Program | Runs the model | Characters | Memory to run | Build argument |
|---|---|---|---|---|
| brnfck-135m | SmolLM2-135M-Instruct | 1,030,902,380 | about 1.5 GB | `small` |
| brnfck-0.5b | Qwen2.5-0.5B-Instruct | 4,169,659,608 | about 4 GB | `0.5b` |
| brnfck-1.5b | Qwen2.5-1.5B-Instruct | 11,430,468,880 | about 8 GB | `1.5b` |

## What you need

- Node.js 24 and Python 3.12. No packages, no compiler.
- For brnfck-135m: about 5.5 GB of free disk space and 3.5 GB of free memory.
- For brnfck-0.5b: about 16 GB of free disk space and 7 GB of free memory.
- For brnfck-1.5b: about 27 GB of free disk space and 13 GB of free memory.

## 1. Get the code

```
git clone https://github.com/rutgerklamer/brnfck-chat.git
cd brnfck-chat
```

## 2. Download a model

The program is built from the model's own files. Make the folder and put these files in it.

| Folder | Files from |
|---|---|
| `compiler/downloads/smollm2-135m/` | https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct |
| `compiler/downloads/qwen2.5-0.5b/` | https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct |
| `compiler/downloads/qwen2.5-1.5b/` | https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct |

Each folder needs `config.json`, `model.safetensors`, `tokenizer.json` and `tokenizer_config.json`.
The two Qwen folders also need `generation_config.json`.

```
mkdir -p compiler/downloads/smollm2-135m
cd compiler/downloads/smollm2-135m
curl -L -O https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/config.json
curl -L -O https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors
curl -L -O https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/tokenizer.json
curl -L -O https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/tokenizer_config.json
cd ../../..
```

## 3. Build the program

```
node tools/build.js small --dry-run     # checks the files, the memory and the disk; runs nothing
node tools/build.js small               # builds the program and verifies it
```

The build writes `site/programs/brnfck-135m.bf`. For `0.5b` and `1.5b` it writes `brnfck-0.5b.bf` and
`brnfck-1.5b.bf` in the same folder.

The last step verifies the result three ways: the file holds only the eight commands, the memory
it writes equals the memory of the loaded model, and it prints the same text as a plain
whole-number version of the model. Every check it prints must start with `ok`, and the last line
must read `all <n> ok`.

On the computer that built these programs (8 cores, 32 GB) the whole run took about 30 minutes
for `small`, 20 for `0.5b` and 50 for `1.5b`. Most of that is the verification. `--quick` verifies
with one question, `--no-verify` skips it, and `--from 4` goes on at step 4 after a stop.

## 4. Ask a question

```
node compiler/smollm/pure/ask.js "What is the capital of France?"
node compiler/qwen/program/ask.js --model 0.5b "What is 7 times 8?"
node compiler/qwen/program/ask.js --model 1.5b "What is 12 + 30?"
```

The first line asks brnfck-135m, the second brnfck-0.5b, the third brnfck-1.5b.

## 5. Open the site

```
python tools/serve.py                   # then open http://localhost:8766/
```

The chat on the start page finds the program you built in `site/programs/`. Choose the program
on the right, type a question, and press Ask.

The lessons, the playground, the patterns, the challenges and the reference work without a build.
The pages "Inside the program", "Program map" and "About the project" draw data that is made from
a built program. These commands write it to `site/inside/data/small/` and
`site/inside/data/compare.json`:

```
node --max-old-space-size=4096 tools/map-data/writer.js small
node tools/map-data/sections.js small
node tools/map-data/tiles.js small
node tools/map-data/depth.js small
node --max-old-space-size=4096 tools/map-data/trace.js small
node --max-old-space-size=4096 tools/map-data/trace.js small "Why is the sky blue?" sky
node tools/map-data/checks.js small
node tools/map-data/compare.js
```

For brnfck-0.5b and brnfck-1.5b, run the same commands with `0.5b` or `1.5b` in place of `small`,
with one trace.js run instead of two:

```
node --max-old-space-size=4096 tools/map-data/trace.js 0.5b
node --max-old-space-size=4096 tools/map-data/trace.js 1.5b "What is 12 + 30?" sum --max 25
```

For `1.5b`, give writer.js `--max-old-space-size=6144`. checks.js reads the log of the
verification in step 3, so build without `--quick` and `--no-verify` first. Run compare.js last:
it gathers the programs that have data.

## 6. Put it on a web host

The site is plain files: upload the folder `site/`, with the data of step 5. Leave out
`site/programs/`. Those files are gigabytes, and a visitor's browser reads the program as small
compressed pieces instead:

```
node tools/make-chunks.js small                   # writes site/dist/small/
node tools/make-chunks.js 0.5b                    # writes site/dist/0.5b/
node tools/make-chunks.js 1.5b --chunk 16777216   # writes site/dist/1.5b/, in pieces of 16 MiB
node tools/make-chunks.js verify small            # reads them back; must print "ok"
```

`node tools/make-chunks.js single small` adds the whole program as one compressed file, which the
start page offers as a download.

`site/program-hosts.json` says where each program's pieces are. An empty value means
`dist/<name>/` on the site itself. An address means another host, which must allow other sites to
read from it. `site/inside/data-hosts.json` does the same for the data of step 5.

## Folders

| Folder | What is in it |
|---|---|
| `site/` | the web site |
| `compiler/` | the generators that write a model out as brainfuck, and the scripts that verify the result |
| `tools/` | build, pieces for a web host, data for the map, the pages of the code patterns, the local server |

The pages in `site/patterns/` are written from `site/patterns/data.js`. After a change there, run
`node tools/build-patterns.js`.

## Licence

The code and the site are MIT licensed: see `LICENSE`. The built programs and the `calib.json` files
hold values of the models, so the models' licence, Apache 2.0, applies to them: see `NOTICE` and
`LICENSES/Apache-2.0.txt`. `tools/make-chunks.js` puts both next to every program it splits.

## Credits

- SmolLM2-135M-Instruct by Hugging Face (HuggingFaceTB), Apache 2.0.
- Qwen2.5-0.5B-Instruct and Qwen2.5-1.5B-Instruct by Alibaba Cloud, Apache 2.0.
- Brainfuck was designed by Urban Müller in 1993.
