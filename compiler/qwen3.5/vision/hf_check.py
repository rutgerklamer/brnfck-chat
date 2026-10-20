# What the Hugging Face code of Qwen3.5-0.8B makes of a picture: the squares the processor cuts, the vectors the
# vision part gives the text model, and the greedy answer. compiler/qwen3.5/vision/check_float.js compares
# compiler/qwen3.5/reference/vision.js with these files. This check is the only part of the project that needs
# packages: torch, transformers (5.x), pillow.
#   python compiler/qwen3.5/vision/hf_check.py compiler/qwen3.5/vision/pictures/cat.png "Describe this picture in one sentence."
import json
import os
import sys

import torch
from PIL import Image
from transformers import AutoProcessor, Qwen3_5ForConditionalGeneration

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', '..', 'downloads', 'qwen3.5-0.8b')
OUT = os.path.join(HERE, 'out')


def main():
    picture, question = sys.argv[1], ' '.join(sys.argv[2:]) or 'Describe this picture in one sentence.'
    name = os.path.splitext(os.path.basename(picture))[0]
    os.makedirs(OUT, exist_ok=True)
    torch.set_grad_enabled(False)
    processor = AutoProcessor.from_pretrained(MODEL)
    model = Qwen3_5ForConditionalGeneration.from_pretrained(MODEL, dtype=torch.float32).eval()
    image = Image.open(picture).convert('RGB')
    messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': question}]}]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True, enable_thinking=False)
    inputs = processor(text=[prompt], images=[image], return_tensors='pt')
    grid = inputs['image_grid_thw'][0].tolist()
    vision = model.model.visual(inputs['pixel_values'], grid_thw=inputs['image_grid_thw'])
    emb = vision.pooler_output.float().contiguous()
    out = model.generate(**inputs, max_new_tokens=60, do_sample=False)
    ids = out[0, inputs['input_ids'].shape[1]:].tolist()
    stops = {processor.tokenizer.convert_tokens_to_ids(t) for t in ('<|im_end|>', '<|endoftext|>')}
    ids = ids[:next((i for i, t in enumerate(ids) if t in stops), len(ids))]     # up to the end of the turn
    inputs['pixel_values'].float().numpy().astype('<f4').tofile(os.path.join(OUT, f'hf-{name}-pixels.f32'))
    emb.numpy().astype('<f4').tofile(os.path.join(OUT, f'hf-{name}-emb.f32'))
    rec = {
        'made': 'compiler/qwen3.5/vision/hf_check.py', 'picture': os.path.basename(picture), 'question': question,
        'grid_thw': grid, 'prompt': prompt, 'input_ids': inputs['input_ids'][0].tolist(),
        'pixels_shape': list(inputs['pixel_values'].shape), 'emb_shape': list(emb.shape),
        'answer_ids': ids, 'answer': processor.tokenizer.decode(ids),
        'torch': torch.__version__, 'transformers': __import__('transformers').__version__,
    }
    with open(os.path.join(OUT, f'hf-{name}.json'), 'w', encoding='utf-8') as f:
        json.dump(rec, f, ensure_ascii=False)
    print(f'{name}: grid {grid}, {emb.shape[0]} vectors of {emb.shape[1]}')
    print(f'> {question}\n{rec["answer"]}')


if __name__ == '__main__':
    main()
