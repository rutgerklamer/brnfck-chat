# Asks a model the questions of a JSON file and writes its answers: greedy, at most 256 tokens of conversation,
# the way the brainfuck program answers.
#   .venv/Scripts/python compiler/coder/ask.py [questions.json] [answers.json] [--model DIR] [--checkpoint FILE] [--cpu]

import argparse, json, os, time
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(os.path.dirname(__file__), 'out')
PREFIX = '<|im_start|>system\nYou are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>\n<|im_start|>user\n'
SUFFIX = '<|im_end|>\n<|im_start|>assistant\n'
MAX_TOKENS = 256

a = argparse.ArgumentParser()
a.add_argument('questions', nargs='?', default=os.path.join(OUT, 'challenges.json'))
a.add_argument('answers', nargs='?', default=os.path.join(OUT, 'answers.json'))
a.add_argument('--model', default=os.path.join(ROOT, 'compiler', 'downloads', 'qwen2.5-coder-0.5b-brainfuck'))
a.add_argument('--checkpoint')  # the weights of a checkpoint of compiler/coder/train.py instead
a.add_argument('--cpu', action='store_true')  # leaves the GPU to a training run
args = a.parse_args()

tok = AutoTokenizer.from_pretrained(args.model)
dev = 'cpu' if args.cpu else 'cuda'
model = AutoModelForCausalLM.from_pretrained(args.model, dtype=torch.float32 if args.cpu else torch.bfloat16)
if args.checkpoint and args.checkpoint.endswith('.safetensors'):   # a snapshot of train.py: the weights alone, the output layer tied
    from safetensors.torch import load_file
    model.load_state_dict({k: v.float() for k, v in load_file(args.checkpoint).items()}, strict=False)
    model.tie_weights()
elif args.checkpoint:
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True)['model'])
model = model.to(dev).eval()
END = [tok.convert_tokens_to_ids('<|im_end|>'), tok.convert_tokens_to_ids('<|endoftext|>')]
rows = json.load(open(args.questions, encoding='utf8'))
t0 = time.time()
for r in rows:
    ids = tok(PREFIX + r['question'] + SUFFIX, add_special_tokens=False, return_tensors='pt')['input_ids'].to(dev)
    with torch.no_grad():
        out = model.generate(ids, max_new_tokens=MAX_TOKENS - ids.shape[1], do_sample=False, eos_token_id=END, pad_token_id=END[0])
    r['answer'] = tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True)
json.dump(rows, open(args.answers, 'w', encoding='utf8'), indent=1)
print(f'{len(rows)} answers written to {args.answers} in {time.time() - t0:.0f} s')
