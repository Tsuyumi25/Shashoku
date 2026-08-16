"""PP-OCR, through RapidOCR's ONNX Runtime backend.

The one model here that does not run on torch, and the reason is worth keeping
because the opposite reason applies next door. Freezing a model into an ONNX
file costs whatever the export left behind: manga-ocr's published exports have
no beam search, and measured against its author's own test set they read ten of
twelve where torch reads twelve. This model has nothing of that kind to lose —
it is one convolutional pass that emits a whole line at once, with no state
between characters and no choice to search over. So the export keeps everything
and the runtime's fused kernels are pure gain. Measured on one page, twice:

    load 2.8x faster, a line 4.8x faster, a page detected 3.8x faster, and a
    gigabyte less at peak — with the same twenty-eight boxes and the same text.

Paddle ships its own format and RapidOCR maintains the translation both ways,
so neither backend here is the publisher's own container. That makes this a
choice about which translation runs well rather than about staying upstream.

Detection and recognition stay two calls because that is how the rest of the
app asks: a box drawn by hand is as good an input to reading as a detected one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..crop import crops

# One multilingual checkpoint per task, so the language only decides whether
# the request is allowed rather than which weights answer it. `japan` is absent
# from the tiny build, which is half the reason this is the medium one.
MODEL_TYPE = "medium"

# Finding where ink is does not depend on what language the ink is in, and the
# detector's own vocabulary of languages says so — it offers no Japanese to
# pick. Reading does depend on it.
DETECT_LANGUAGE = "ch"
READ_LANGUAGE = "japan"


class PpOcrReader:
    def __init__(self) -> None:
        self.engine: Any = None

    def is_loaded(self) -> bool:
        return self.engine is not None

    def cached(self) -> bool:
        # RapidOCR keeps its weights beside itself rather than in a shared
        # cache, and names them after the model it resolved, so the question is
        # whether those two files are on disk.
        import rapidocr

        models = Path(rapidocr.__file__).parent / "models"
        return all(
            (models / f"PP-OCRv6_{task}_{MODEL_TYPE}.onnx").is_file() for task in ("det", "rec")
        )

    def load(self) -> None:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

        shared = {
            "engine_type": EngineType.ONNXRUNTIME,
            "ocr_version": OCRVersion.PPOCRV6,
            "model_type": ModelType(MODEL_TYPE),
        }
        self.engine = RapidOCR(
            params={
                **{f"Det.{k}": v for k, v in shared.items()},
                **{f"Rec.{k}": v for k, v in shared.items()},
                "Det.lang_type": LangDet(DETECT_LANGUAGE),
                "Rec.lang_type": LangRec(READ_LANGUAGE),
                # Detection and recognition are both v6 above. The angle
                # classifier below is not, and stays a v4 for one reason: it is
                # built whatever `use_cls` says, so it has to name weights that
                # exist, and no v6 classifier does. It never runs.
                "Global.use_cls": False,
                "Cls.engine_type": EngineType.ONNXRUNTIME,
            }
        )

    def unload(self) -> None:
        import gc

        self.engine = None
        gc.collect()

    def detect(self, image_path: str, min_score: float | None = None) -> list[dict[str, Any]]:
        """Where the columns of type are, over a whole page.

        The one detector here whose findings are its own. A column is not a
        region — it is a slice of one — so it has nothing to offer the two
        recognizers that read regions, and it proposes nothing on a page that the
        two region detectors have not already proposed.
        """
        page = np.asarray(Image.open(image_path).convert("RGB"))
        found = self.engine(page, use_det=True, use_cls=False, use_rec=False)

        # The network answers with quadrilaterals — it finds ink, and ink does
        # not promise to be upright. What the rest of the app takes is an
        # upright box, so each quad is reduced to the one that contains it.
        quads = getattr(found, "boxes", None)
        lines = []
        for quad in [] if quads is None else quads:
            points = np.asarray(quad, dtype=float).reshape(-1, 2)
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
            lines.append(
                {
                    "label": "line",
                    "score": 1.0,
                    "x": float(left),
                    "y": float(top),
                    "width": float(right - left),
                    "height": float(bottom - top),
                }
            )
        return lines

    def read(self, image_path: str, boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """One column in, one fragment out.

        The odd one out among the readers, and it stays that way. Handing it a
        whole region works — its own detector will cut the columns out of the
        crop — but it is a multilingual model reading at a scale it was not
        detected at, and what comes back for a hand-drawn sound effect is Chinese
        or a digit. What it is good at is printed type, which is what its own
        detector finds and nothing more.
        """
        page = Image.open(image_path)
        lines = []
        for piece in crops(page, boxes):
            # This model reads left to right and knows nothing about Japanese
            # running down the page. A crop taller than it is wide is laid on
            # its side counter-clockwise, which is what puts the first character
            # on the left. The box's own proportions decide, because text set
            # vertically fills a tall box — and a misjudgement announces itself
            # in the confidence rather than passing quietly.
            if piece.height > piece.width:
                piece = piece.transpose(Image.Transpose.ROTATE_90)
            read = self.engine(
                np.asarray(piece.convert("RGB")), use_det=False, use_cls=False, use_rec=True
            )
            texts = getattr(read, "txts", None)
            scores = getattr(read, "scores", None)
            lines.append(
                {
                    "text": texts[0] if texts is not None and len(texts) else "",
                    "confidence": float(scores[0]) if scores is not None and len(scores) else 0.0,
                }
            )
        return lines
