"""The balloon detector, as a stock transformers model.

Nothing here reproduces the author's preprocessing, which matters more than it
sounds: this model asks to be resized bilinear, and both pipelines this replaces
resized it bicubic. Letting the processor read its own config moves a few
low-confidence boxes by a pixel or two, in the direction the weights were
trained for.
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..weights import hub_cached, pinned

REPO = "ogkalu/comic-text-and-bubble-detector"
REVISION = "16e8a622f91fabc6b5b65c96d32d1183f8843546"

# Below this the detector is guessing rather than measuring.
DEFAULT_MIN_SCORE = 0.3


class BubbleDetector:
    def __init__(self) -> None:
        self.processor: Any = None
        self.model: Any = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def cached(self) -> bool:
        return hub_cached(REPO, REVISION)

    def load(self) -> None:
        from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection

        weights = pinned(REPO, REVISION)
        self.processor = AutoImageProcessor.from_pretrained(REPO, **weights)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(REPO, **weights)
        self.model.eval()

    def unload(self) -> None:
        import gc

        self.processor = None
        self.model = None
        gc.collect()

    def detect(self, image_path: str, min_score: float | None = None) -> list[dict[str, Any]]:
        import torch

        threshold = DEFAULT_MIN_SCORE if min_score is None else float(min_score)
        page = Image.open(image_path).convert("RGB")

        inputs = self.processor(images=page, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)

        # The page's own size, so the boxes come back in page coordinates rather
        # than in the 640-square the network worked in.
        found = self.processor.post_process_object_detection(
            outputs,
            target_sizes=torch.tensor([[page.height, page.width]]),
            threshold=threshold,
        )[0]

        labels = self.model.config.id2label
        boxes = []
        for score, label, box in zip(found["scores"], found["labels"], found["boxes"]):
            left, top, right, bottom = (float(v) for v in box)
            boxes.append(
                {
                    "label": labels.get(int(label), str(int(label))),
                    "score": float(score),
                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top,
                }
            )
        return boxes
