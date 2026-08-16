"""The layout detector — the one that was taught sound effects are a thing.

Built the way its author's `load_model.py` builds it, down to the pinned
package version: this architecture is constructed in code and then handed a
state dict, so a mismatch between the two shows up as missing keys rather than
as a wrong answer.
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..weights import hub_cached, pinned

REPO = "mayocream/koharu-layout-rfdetr-seg-2xl-1152"
REVISION = "aed55fdb8ca953c6bec33cf6ed6dd52a9b72bfa2"
WEIGHTS = "model.safetensors"

CLASS_NAMES = ["text", "onomatopoeia", "bubble", "panel"]
RESOLUTION = 1152
NUM_SELECT = 160

# Per class, from the author's inference_config.json. A single threshold would
# either lose sound effects or fill the page with panels.
THRESHOLDS = {"text": 0.25, "onomatopoeia": 0.2, "bubble": 0.5, "panel": 0.5}

# ⭐ This model draws a box around the ink and stops there, where the balloon
# detector next door leaves air — paired over fifty-seven regions on five pages,
# the other one reaches a further 0.258 of the short side out on every edge,
# median. Two detectors whose boxes mean different things cannot be pooled: a
# recognizer reads the tight one worse, and the two boxes over one balloon
# overlap too little to be recognized as one region.
#
# So the air is added here rather than by whoever crops. A region is the writing
# *and the space around it* — that is what the word has to mean for every reader
# to be handed the same thing.
#
# The share is the one that read best against hand-labelled crops rather than
# the one that closes the gap exactly: from a tenth to a fifth of the short side
# all measure the same, and the low end of that is taken because padding cannot
# see a neighbouring column.
#
# Of the short side, and equal on all four edges. A share of each axis in turn
# gives a tall column almost nothing left and right, which is the one direction
# where 縦書き runs to the edge of the box.
AIR = 0.15

# Containers, which are already the space around something. Growing a panel
# would push it into the ones beside it.
INK_ONLY = {"text", "onomatopoeia"}


class LayoutDetector:
    def __init__(self) -> None:
        self.model: Any = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def cached(self) -> bool:
        return hub_cached(REPO, REVISION, allow_patterns=[WEIGHTS])

    def load(self) -> None:
        import warnings

        from huggingface_hub import hf_hub_download
        from rfdetr import RFDETRSeg2XLarge
        from rfdetr.config import PretrainWeightsCompatibilityWarning
        from safetensors.torch import load_file

        weights = hf_hub_download(REPO, WEIGHTS, **pinned(REPO, REVISION, allow_patterns=[WEIGHTS]))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", PretrainWeightsCompatibilityWarning)
            model = RFDETRSeg2XLarge(
                pretrain_weights=None,
                resolution=RESOLUTION,
                num_select=NUM_SELECT,
                num_classes=len(CLASS_NAMES),
            )
        incompatible = model.model.model.load_state_dict(load_file(weights, device="cpu"), strict=True)
        if incompatible.missing_keys or incompatible.unexpected_keys:
            raise RuntimeError(f"incompatible weights: {incompatible}")
        model.model.class_names = CLASS_NAMES.copy()

        # The half of the author's inference preparation that is free. It swaps
        # in the export-time attention and drops the training-only heads, costs
        # a tenth of a second, and answers bit for bit what the unprepared model
        # answers.
        #
        # `compile=True` is the other half and is left off: tracing this
        # architecture takes eleven seconds and buys about fourteen percent, so
        # it only pays back somewhere past the thirtieth page of one sitting.
        # That makes it a lever for reading a chapter, not for reading a page —
        # and it freezes the batch axis at one, which is the very thing that
        # made someone else's export a dead end.
        model.optimize_for_inference(compile=False)
        self.model = model

    def unload(self) -> None:
        import gc

        self.model = None
        gc.collect()

    def detect(self, image_path: str, min_score: float | None = None) -> list[dict[str, Any]]:
        page = Image.open(image_path).convert("RGB")

        # One pass at the loosest threshold any class asks for, then each class
        # judged by its own — the model is only run once either way.
        floor = min(THRESHOLDS.values()) if min_score is None else float(min_score)
        found = self.model.predict(page, threshold=floor)

        boxes = []
        for (left, top, right, bottom), score, class_id in zip(
            found.xyxy, found.confidence, found.class_id
        ):
            label = CLASS_NAMES[int(class_id)] if int(class_id) < len(CLASS_NAMES) else str(int(class_id))
            if min_score is None and float(score) < THRESHOLDS.get(label, floor):
                continue
            x1, y1, x2, y2 = float(left), float(top), float(right), float(bottom)
            if label in INK_ONLY:
                air = min(x2 - x1, y2 - y1) * AIR
                x1, y1 = max(0.0, x1 - air), max(0.0, y1 - air)
                x2 = min(float(page.width), x2 + air)
                y2 = min(float(page.height), y2 + air)
            boxes.append(
                {
                    "label": label,
                    "score": float(score),
                    "x": x1,
                    "y": y1,
                    "width": x2 - x1,
                    "height": y2 - y1,
                }
            )
        return boxes
