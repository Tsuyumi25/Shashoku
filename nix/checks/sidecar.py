"""Whether the sidecar's environment can compute, not merely import.

Every library here reaches its native half only when something is asked of it,
so an environment patched wrongly imports clean and fails on the first page.
The calls below are the cheapest ones that cross into native code: `nms` is the
extension that needed torch on its search path, and tokenising Japanese is what
proves the dictionary beside the tokeniser arrived.

Run by the interpreter under test. Nothing here touches the network.
"""

import numpy as np
import cv2
import torch
import torchvision
import onnxruntime  # noqa: F401
import transformers  # noqa: F401
import rapidocr  # noqa: F401
import rfdetr  # noqa: F401
import manga_ocr  # noqa: F401
import shashoku_ocr  # noqa: F401
from shashoku_ocr.registry import MODELS
from shapely.geometry import Polygon
from fugashi import Tagger

assert cv2.resize(np.zeros((8, 8, 3), np.uint8), (4, 4)).shape == (4, 4, 3)
assert Polygon([(0, 0), (2, 0), (2, 2), (0, 2)]).area == 4.0
assert torchvision.ops.nms(
    torch.tensor([[0.0, 0.0, 1.0, 1.0]]), torch.tensor([0.9]), 0.5
).tolist() == [0]
assert [w.surface for w in Tagger()("日本語")] == ["日本", "語"]
assert set(MODELS) == {
    "anime-lama",
    "baberu",
    "bubble",
    "hayai",
    "layout",
    "mangaocr",
    "ppocr",
}
