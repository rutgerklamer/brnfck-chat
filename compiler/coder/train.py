# Teaches Qwen2.5-Coder-0.5B-Instruct to answer a task with a brainfuck program (compiler/coder/out/train.jsonl).
# Writes compiler/downloads/qwen2.5-coder-0.5b-brainfuck/ in the layout of the downloaded model, which
# compiler/qwen/ builds a brainfuck program from.
#   .venv/Scripts/python compiler/coder/train.py [--epochs 2] [--lr 2e-5] [--resume] [--src DIR] [--dst DIR]
# With --plain FILE (compiler/coder/stack.py) it is the first stage instead: brainfuck as people wrote it, the loss on
# every token, no question; the second stage then starts from its --dst with --src.
# Every 500 steps it saves compiler/coder/out/checkpoint.pt; an empty file compiler/coder/out/STOP makes it save and stop.

import argparse, json, math, os, random, shutil, time
import torch
from safetensors.torch import save_file
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DOWNLOADS = os.path.join(ROOT, 'compiler', 'downloads')
DATA = os.path.join(os.path.dirname(__file__), 'out')
# The chat as the brainfuck program builds it (compiler/qwen/tokenizer/ref.js), with the answer after it.
PREFIX = '<|im_start|>system\nYou are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>\n<|im_start|>user\n'
SUFFIX = '<|im_end|>\n<|im_start|>assistant\n'
MAX_TOKENS = 256  # the longest conversation the program holds

a = argparse.ArgumentParser()
a.add_argument('--epochs', type=float, default=2)
a.add_argument('--lr', type=float, default=2e-5)
a.add_argument('--batch', type=int, default=32)
a.add_argument('--micro', type=int, default=8)
a.add_argument('--seed', type=int, default=1)
a.add_argument('--log', type=int, default=50)
a.add_argument('--train-embedding', action='store_true')  # the embedding (tied to the output layer) stays as it was unless asked
a.add_argument('--resume', action='store_true')
a.add_argument('--src', default=os.path.join(DOWNLOADS, 'qwen2.5-coder-0.5b'))
a.add_argument('--dst', default=os.path.join(DOWNLOADS, 'qwen2.5-coder-0.5b-brainfuck'))
a.add_argument('--plain')
a.add_argument('--snap', type=int, default=1000)  # every so many steps the weights alone, as out/snap-<step>.safetensors (0: none)
args = a.parse_args()
SRC, DST = args.src, args.dst
random.seed(args.seed)
torch.manual_seed(args.seed)
# An error rather than the slow (and on this machine unstable) spill of GPU memory into system memory.
torch.cuda.set_per_process_memory_fraction(0.85)
CHECKPOINT, STOP = os.path.join(DATA, 'checkpoint.pt'), os.path.join(DATA, 'STOP')

tok = AutoTokenizer.from_pretrained(SRC)
END = tok.convert_tokens_to_ids('<|im_end|>')

def encode(row):
    prompt = tok(PREFIX + row['question'] + SUFFIX, add_special_tokens=False)['input_ids']
    answer = tok(row['code'], add_special_tokens=False)['input_ids'] + [END]
    return prompt, answer

def load(file):
    rows = [json.loads(l) for l in open(os.path.join(DATA, file), encoding='utf8')]
    out, long = [], 0
    for r in rows:
        p, ans = encode(r)
        if len(p) + len(ans) > MAX_TOKENS: long += 1; continue
        out.append((p, ans))
    return out, long

if args.plain:
    # windows of brainfuck tokens: no question, the loss on every token
    windows = [([], json.loads(l)) for l in open(args.plain, encoding='utf8')]
    random.shuffle(windows)
    cut = max(64, len(windows) // 50)
    train, test, long = windows[cut:], windows[:cut], 0
else:
    train, long = load('train.jsonl')
    test, _ = load('test.jsonl')
lens = sorted(len(p) + len(x) for p, x in train)
print(f'{len(train)} training examples ({long} longer than {MAX_TOKENS} tokens left out), {len(test)} test; tokens per example: median {lens[len(lens) // 2]}, longest {lens[-1]}')

def batches(rows, size, shuffle):
    idx = list(range(len(rows)))
    if shuffle: random.shuffle(idx)
    for i in range(0, len(idx), size):
        part = [rows[j] for j in idx[i:i + size]]
        n = max(len(p) + len(x) for p, x in part)
        ids = torch.full((len(part), n), END, dtype=torch.long)
        labels = torch.full((len(part), n), -100, dtype=torch.long)
        mask = torch.zeros((len(part), n), dtype=torch.long)
        for k, (p, x) in enumerate(part):
            seq = p + x
            ids[k, :len(seq)] = torch.tensor(seq)
            labels[k, len(p):len(seq)] = torch.tensor(x)
            mask[k, :len(seq)] = 1
        yield ids.cuda(), labels.cuda(), mask.cuda()

model = AutoModelForCausalLM.from_pretrained(SRC, dtype=torch.float32).cuda()
model.gradient_checkpointing_enable()
if not args.train_embedding:
    model.get_input_embeddings().weight.requires_grad_(False)
    model.enable_input_require_grads()  # so the checkpointed layers still pass gradients back
model.config.use_cache = False
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0, betas=(0.9, 0.95), fused=True)
steps = math.ceil(len(train) / args.batch * args.epochs)
warm = min(100, steps // 10)
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / warm if s < warm else 0.5 * (1 + math.cos(math.pi * (s - warm) / max(1, steps - warm))))
accum = args.batch // args.micro

def evaluate():
    model.eval()
    tot, n, right, seqs = 0.0, 0, 0, 0
    with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
        for ids, labels, mask in batches(test, 8, False):
            logits = model(input_ids=ids, attention_mask=mask).logits[:, :-1].float()
            lab = labels[:, 1:]
            loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), lab.reshape(-1), ignore_index=-100, reduction='sum')
            tot += loss.item(); n += (lab != -100).sum().item()
            ok = ((logits.argmax(-1) == lab) | (lab == -100)).all(dim=1)  # every token of the answer is the likeliest one
            right += ok.sum().item(); seqs += ok.numel()
    model.train()
    return tot / n, right / seqs

def save_checkpoint():
    tmp = CHECKPOINT + '.tmp'
    torch.save({'model': model.state_dict(), 'opt': opt.state_dict(), 'sched': sched.state_dict(), 'step': step, 'epoch': epoch}, tmp)
    os.replace(tmp, CHECKPOINT)

step, epoch = 0, 0
if args.resume and os.path.exists(CHECKPOINT):
    c = torch.load(CHECKPOINT, map_location='cuda', weights_only=True)
    model.load_state_dict(c['model']); opt.load_state_dict(c['opt']); sched.load_state_dict(c['sched'])
    step, epoch = c['step'], c['epoch']
    random.seed(args.seed + step)  # a fresh order for the rest of the data
    del c
    print(f'resumed at step {step}', flush=True)
else:
    print(f'before: test loss {evaluate()[0]:.4f}', flush=True)
model.train()
t0 = time.time()
while step < steps:
    stream = batches(train, args.micro, True)
    for i, (ids, labels, mask) in enumerate(stream):
        with torch.autocast('cuda', dtype=torch.bfloat16):
            out = model(input_ids=ids, attention_mask=mask, labels=labels)
        (out.loss / accum).backward()
        if (i + 1) % accum: continue
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
        step += 1
        if step % args.log == 0:
            print(f'step {step}/{steps}  loss {out.loss.item():.4f}  lr {sched.get_last_lr()[0]:.2e}  {time.time() - t0:.0f} s  {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB', flush=True)
        if step % 500 == 0 or step == steps:
            loss, exact = evaluate()
            print(f'  test loss {loss:.4f}, whole answer exactly right (one pass, greedy per token) {100 * exact:.1f}%', flush=True)
            if step < steps: save_checkpoint()
        if args.snap and step % args.snap == 0 and step < steps:
            # the weights alone, to pick the best moment afterwards on tasks that are not the test (check.js)
            save_file({k: v.detach().to(torch.bfloat16).contiguous().cpu() for k, v in model.state_dict().items() if k != 'lm_head.weight'},
                      os.path.join(DATA, f'snap-{step}.safetensors'), metadata={'format': 'pt'})
        if os.path.exists(STOP):
            save_checkpoint(); os.remove(STOP)
            print(f'stopped at step {step}; continue with --resume', flush=True)
            raise SystemExit
        if step >= steps: break
    epoch += 1

# Save in the layout of the download: one bf16 safetensors file, the output layer tied to the embedding.
os.makedirs(DST, exist_ok=True)
sd = {k: v.detach().to(torch.bfloat16).contiguous().cpu() for k, v in model.state_dict().items() if k != 'lm_head.weight'}
save_file(sd, os.path.join(DST, 'model.safetensors'), metadata={'format': 'pt'})
for f in ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json']:
    shutil.copy(os.path.join(SRC, f), os.path.join(DST, f))
if os.path.exists(CHECKPOINT): os.remove(CHECKPOINT)  # only needed to continue an unfinished run
print(f'{DST} written ({time.time() - t0:.0f} s of training)')
