# The first stage of teaching brnfck-qwen2.5-coder-0.5b: brainfuck as people wrote it, from the Brainfuck files of
# The Stack (BigCode, deduplicated, permissively licensed). Needs the terms of bigcode/the-stack-dedup accepted on
# Hugging Face and a login on this computer (.venv/Scripts/hf auth login).
# Keeps only the eight commands, drops files whose brackets do not match, short ones and copies, and cuts long
# programs into windows the model can hold.
#   .venv/Scripts/python compiler/coder/stack.py   ->  compiler/coder/out/stack.jsonl, stack.txt (what it kept)

import hashlib, json, os, re
import pyarrow.parquet as pq
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(os.path.dirname(__file__), 'out')
SRC = os.path.join(ROOT, 'compiler', 'downloads', 'qwen2.5-coder-0.5b')
WINDOW = 240            # tokens per piece: the conversation of the program holds 256
MIN_COMMANDS = 24

path = hf_hub_download('bigcode/the-stack-dedup', 'data/brainfuck/data-00000-of-00001.parquet', repo_type='dataset')
table = pq.read_table(path, columns=['content', 'max_stars_repo_name', 'max_stars_repo_licenses'])
rows = table.to_pylist()
tok = AutoTokenizer.from_pretrained(SRC)

def balanced(code):
    d = 0
    for c in code:
        d += c == '['
        d -= c == ']'
        if d < 0: return False
    return d == 0

kept, seen, why = [], set(), {'unbalanced': 0, 'short': 0, 'copy': 0}
for r in rows:
    code = re.sub(r'[^+\-<>\[\].,]', '', r['content'] or '')
    if len(code) < MIN_COMMANDS: why['short'] += 1; continue
    if not balanced(code): why['unbalanced'] += 1; continue
    h = hashlib.sha256(code.encode()).hexdigest()
    if h in seen: why['copy'] += 1; continue
    seen.add(h)
    kept.append((code, r['max_stars_repo_name'], r['max_stars_repo_licenses']))

pieces, programs_whole = [], 0
for code, repo, lic in kept:
    ids = tok(code, add_special_tokens=False)['input_ids']
    if len(ids) <= WINDOW: programs_whole += 1
    for i in range(0, len(ids), WINDOW):
        pieces.append(ids[i:i + WINDOW])

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'stack.jsonl'), 'w', encoding='utf8') as f:
    for p in pieces: f.write(json.dumps(p) + '\n')
tokens = sum(len(p) for p in pieces)
lines = [f'{len(rows)} Brainfuck files in The Stack (deduplicated); kept {len(kept)} after removing {why["short"]} shorter than {MIN_COMMANDS} commands, '
         f'{why["unbalanced"]} whose brackets do not match and {why["copy"]} copies once comments are gone',
         f'{programs_whole} programs fit in one window of {WINDOW} tokens; {len(pieces)} windows, {tokens} tokens, {sum(len(c) for c, _, _ in kept)} commands in all']
open(os.path.join(OUT, 'stack.txt'), 'w', encoding='utf8').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
