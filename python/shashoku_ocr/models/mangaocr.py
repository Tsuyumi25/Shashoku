"""manga-ocr, through the package its author publishes.

Reaching past `MangaOcr.__call__` rather than calling it: that method answers
with a string and nothing else, and a reading without the probability the model
put on it cannot be compared against another recognizer's. Everything else here
— the processor, the tokenizer, the widening of half-width forms — is the
author's own, reused rather than reproduced.
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..crop import crops
from ..weights import hub_cached, pinned

REPO = "kha-white/manga-ocr-base"
REVISION = "aa6573bd10b0d446cbf622e29c3e084914df9741"

# A line that never ends is a runaway, not a long line. The author's own limit.
MAX_TOKENS = 300


class MangaOcrReader:
    def __init__(self) -> None:
        self.ocr: Any = None

    def is_loaded(self) -> bool:
        return self.ocr is not None

    def cached(self) -> bool:
        return hub_cached(REPO, REVISION)

    def load(self) -> None:
        from huggingface_hub import snapshot_download
        from manga_ocr import MangaOcr

        # Fetched here and handed over as a directory. The author's class takes
        # a name and has nowhere to put a revision, so the only place to say
        # which one is on the way in — and a local path is a name it accepts.
        self.ocr = MangaOcr(snapshot_download(REPO, **pinned(REPO, REVISION)))

    def unload(self) -> None:
        import gc

        import torch

        self.ocr = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def read(self, image_path: str, boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        import torch

        from manga_ocr.ocr import post_process

        page = Image.open(image_path)
        model = self.ocr.model
        lines = []

        for piece in crops(page, boxes):
            grey = piece.convert("L").convert("RGB")
            pixels = self.ocr.processor(grey, return_tensors="pt").pixel_values
            with torch.no_grad():
                generated = model.generate(
                    pixels.to(model.device),
                    max_length=MAX_TOKENS,
                    output_scores=True,
                    return_dict_in_generate=True,
                )
            sequence = generated.sequences[0].cpu()

            # The geometric mean of the per-character probabilities, not the
            # worst of them. The worst punishes a long reading for one uncertain
            # character, and this number exists to be compared against a
            # recognizer that is known to drop characters, and so to answer
            # shorter — scoring by the worst would reward it for that failure.
            scores = model.compute_transition_scores(
                generated.sequences,
                generated.scores,
                getattr(generated, "beam_indices", None),
                normalize_logits=True,
            )[0]
            kept = scores[torch.isfinite(scores)]
            confidence = float(kept.mean().exp()) if kept.numel() else 0.0

            text = post_process(self.ocr.tokenizer.decode(sequence, skip_special_tokens=True))
            lines.append({"text": text, "confidence": confidence})

        return lines
