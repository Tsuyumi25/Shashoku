"""Baberu, through the inference script its author ships as the source of truth.

The model's config carries no `auto_map`, so `trust_remote_code` has nothing to
follow: the architecture is reached the way the model card reaches it, by
putting the downloaded snapshot on the import path and using the classes in it.

Worth knowing why that matters here rather than being a formality. This decoder
needs two anti-loop guards to reproduce its published accuracy — a repetition
penalty and a cap on runs of identical *content* characters that leaves runs of
・・・ and ーー alone — and both live in that script rather than in the weights.
"""

from __future__ import annotations

import sys
import threading
from typing import Any

from PIL import Image

from ..crop import crops
from ..weights import hub_cached, pinned

REPO = "genshiai-daichi/baberu-ocr"
REVISION = "d9cc13153e9a1cd8fdfa3b7b1cc329da2020aeae"
# The ONNX build is a third of the download and none of what this model is
# for, so it is left on the server.
IGNORE = ["onnx/*", "assets/*"]

MAX_NEW_TOKENS = 128
REPETITION_PENALTY = 1.2
MAX_CONTENT_RUN = 12

# Importing the author's modules puts three common names on the import path, so
# two models loading at once must not race to do it.
_import_gate = threading.Lock()


def _author_module(snapshot: str) -> Any:
    import importlib

    with _import_gate:
        if snapshot not in sys.path:
            sys.path.insert(0, snapshot)
        return importlib.import_module("inference")


class BaberuReader:
    def __init__(self) -> None:
        self.ocr: Any = None

    def is_loaded(self) -> bool:
        return self.ocr is not None

    def cached(self) -> bool:
        return hub_cached(REPO, REVISION, ignore_patterns=IGNORE)

    def load(self) -> None:
        from huggingface_hub import snapshot_download

        snapshot = snapshot_download(
            REPO, ignore_patterns=IGNORE, **pinned(REPO, REVISION, ignore_patterns=IGNORE)
        )
        self.ocr = _author_module(snapshot).BaberuOCR(snapshot)

    def unload(self) -> None:
        import gc

        self.ocr = None
        gc.collect()

    def read(self, image_path: str, boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        import torch
        from transformers import LogitsProcessorList

        module = sys.modules["inference"]
        ocr = self.ocr
        page = Image.open(image_path)
        lines = []

        for piece in crops(page, boxes):
            pixel_values = ocr.image_processor(piece.convert("RGB"), return_tensors="pt")[
                "pixel_values"
            ].to(ocr.device)
            start = torch.tensor([[ocr.tok.bos_token_id]], device=ocr.device)

            with torch.inference_mode():
                generated = ocr.model.generate(
                    input_ids=start,
                    pixel_values=pixel_values,
                    max_new_tokens=MAX_NEW_TOKENS,
                    do_sample=False,
                    repetition_penalty=REPETITION_PENALTY,
                    logits_processor=LogitsProcessorList(
                        [module.CapContentRun(ocr._content_ids, MAX_CONTENT_RUN)]
                    ),
                    eos_token_id=ocr.tok.eos_token_id,
                    pad_token_id=ocr.tok.pad_token_id,
                    bos_token_id=ocr.tok.bos_token_id,
                    use_cache=True,
                    output_logits=True,
                    return_dict_in_generate=True,
                )

            written = generated.sequences[0, start.shape[1] :]
            text = ocr.tok.decode(written.detach().cpu().tolist(), skip_special_tokens=True)

            # Read off the logits the model produced, not the scores the guards
            # left behind: the penalty exists to steer the writing, and letting
            # it also lower the reported confidence would report a model as
            # unsure about the very character it was pushed towards.
            probabilities = []
            for step, raw in enumerate(generated.logits):
                if step >= written.numel():
                    break
                token = int(written[step])
                if token in (ocr.tok.eos_token_id, ocr.tok.pad_token_id):
                    continue
                probabilities.append(float(raw[0].log_softmax(-1)[token]))

            confidence = (
                float(torch.tensor(probabilities).mean().exp()) if probabilities else 0.0
            )
            lines.append({"text": text, "confidence": confidence})

        return lines
