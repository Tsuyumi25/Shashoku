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
        from transformers import VisionEncoderDecoderModel

        # Fetched here and handed over as a directory. The author's class takes
        # a name and has nowhere to put a revision, so the only place to say
        # which one is on the way in — and a local path is a name it accepts.
        where = snapshot_download(REPO, **pinned(REPO, REVISION))
        self.ocr = MangaOcr(where)

        # ⚠️ Rebuilt with the attention implementation that keeps its map.
        # Scaled dot-product attention never materializes one — that is the
        # fused kernel's whole point — so the cross-attention the positions
        # below are read off does not exist under it.
        #
        # On rather than offered: eager reads about a tenth slower over a
        # page's regions, which is less than a switch and a second code path
        # would cost, and it is the only reason anything downstream can say
        # where a line ends.
        self.ocr.model = (
            VisionEncoderDecoderModel.from_pretrained(where, attn_implementation="eager")
            .to(self.ocr.model.device)
            .eval()
        )

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
                    output_attentions=True,
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
            lines.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "places": self._places(generated, sequence),
                }
            )

        return lines

    def _places(self, generated: Any, sequence: Any) -> list[dict[str, Any]]:
        """Where on the crop each piece of the reading was, as shares of it.

        ⭐ One position per token of the *raw* decode rather than per character
        of the finished text. `post_process` folds an ellipsis into three
        periods and widens half-width forms, so the two strings stop lining up
        character for character — whoever cuts this into lines groups the raw
        pieces and folds each group afterwards.

        The map is the last decoder layer's cross-attention averaged over its
        heads. The encoder is a grid of square patches over a square resize, so
        its centroid is a point on the crop whatever shape the crop was. The
        centroid rather than the brightest cell: a character sitting on a patch
        border lights two of them, and either one alone is half a cell out.
        """
        import torch

        steps = getattr(generated, "cross_attentions", None)
        # An attention implementation that fuses the map away still answers
        # with the shape, which arrives here as empty rather than as absent.
        # Positions are an extra — a reader that cannot give them still reads.
        if not steps or not steps[0]:
            return []
        ids = sequence.tolist()
        special = set(self.ocr.tokenizer.all_special_ids)
        # Less the class token, which stands for the whole crop and so for
        # nowhere in particular.
        patches = steps[0][-1].shape[-1] - 1
        side = int(round(patches**0.5))
        if side * side != patches:
            return []
        axis = torch.arange(side, dtype=torch.float32)

        places = []
        for step, layers in enumerate(steps):
            # The first generated token answers for position one: position zero
            # is the decoder's start marker, which was not read off anything.
            at = step + 1
            if at >= len(ids) or ids[at] in special:
                continue
            grid = layers[-1][0].float().mean(0)[-1][1:].reshape(side, side).cpu()
            weight = grid / grid.sum()
            piece = self.ocr.tokenizer.convert_ids_to_tokens([ids[at]])[0]
            places.append(
                {
                    "text": piece.removeprefix("##"),
                    # The middle of a cell, so a character on the first patch is
                    # not reported as sitting on the crop's very edge.
                    "x": float(((weight.sum(0) * axis).sum() + 0.5) / side),
                    "y": float(((weight.sum(1) * axis).sum() + 0.5) / side),
                }
            )
        return places
