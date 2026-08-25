"""YuzuMarker.FontDetection — how a region is set, rather than what it says.

One forward pass answers the direction the lines stack in, the type size, the
leading, the angle the run sits at and the colours it is drawn in. They are
regression heads sitting beside a font classifier this repository never reads.

⭐ Direction is the reason it is loaded at all. Everything that cuts a region
into lines needs the axis the lines stack on, and no recognizer says: the three
that read a whole crop answer one flat string, and the column cutter finds
columns without saying what they are columns of. A box's own shape answers most
pages and stops answering exactly where it matters — a horizontal block set over
four lines is taller than it is wide.

⚠️ Fitted on rendered type, not on scanned artwork. It held over a page of
handwriting, which is the case with most reason to fail, but this is not the
domain it was trained for and it is worth keeping an eye on.

The published checkpoint keeps Lightning's `model.` and torch.compile's
`_orig_mod.` wrappers around a plain torchvision ResNet-50 with a widened head,
so the state dict is unwrapped rather than the architecture rebuilt.
Upstream: https://github.com/JeffersonQin/YuzuMarker.FontDetection (MIT)
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..crop import crops
from ..weights import hub_cached, pinned

REPO = "fffonion/yuzumarker-font-detection"
REVISION = "7484242bb840f39e27f10df8ade1f8a9a8fa8f53"
WEIGHTS = "yuzumarker-font-detection.safetensors"

# The classifier nothing here reads, the two direction logits, and the ten
# regression values. All three are fixed by the checkpoint's own head.
FONT_COUNT = 6150
REGRESSION = 10
OUTPUT_DIM = FONT_COUNT + 2 + REGRESSION

# Upstream's `config.INPUT_SIZE`, and its transform is the whole of the
# preprocessing: resize to a square and divide by 255. No mean or deviation —
# the checkpoint was fitted without them, and adding ImageNet's would make it a
# different model.
INPUT_SIZE = 512

# Where each regression value lands, in the order the head emits them.
COLOR = slice(0, 3)
SIZE = 3
STROKE_WIDTH = 4
STROKE_COLOR = slice(5, 8)
LINE_SPACING = 8
ANGLE = 9

# What a page of regions goes through in a handful of passes. Nothing here holds
# state between them, so the only thing the number decides is peak memory.
BATCH = 16

# What leading to report when the type size came back at zero and the ratio
# below would divide by it. Ordinary body copy, and a guess that says so.
FALLBACK_LEADING = 120.0


class FontDetector:
    def __init__(self) -> None:
        self.model: Any = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def cached(self) -> bool:
        return hub_cached(REPO, REVISION, allow_patterns=[WEIGHTS])

    def load(self) -> None:
        import torch
        import torchvision
        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file

        path = hf_hub_download(REPO, WEIGHTS, **pinned(REPO, REVISION, allow_patterns=[WEIGHTS]))
        model = torchvision.models.resnet50()
        model.fc = torch.nn.Linear(2048, OUTPUT_DIM)

        prefix = "model._orig_mod.model."
        state = {k[len(prefix) :]: v for k, v in load_file(path).items() if k.startswith(prefix)}
        # Strict, so a checkpoint that has stopped matching this architecture
        # says so here rather than answering confidently about nothing.
        model.load_state_dict(state, strict=True)
        self.model = model.eval()

    def unload(self) -> None:
        import gc

        self.model = None
        gc.collect()

    def read(self, image_path: str, boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """One measurement per region, in the order the regions were given."""
        import torch
        import torchvision

        page = Image.open(image_path).convert("RGB")
        pieces = crops(page, boxes)
        measured: list[dict[str, Any]] = []

        for at in range(0, len(pieces), BATCH):
            window = pieces[at : at + BATCH]
            batch = torch.stack(
                [
                    torchvision.transforms.functional.to_tensor(
                        piece.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
                    )
                    for piece in window
                ]
            )
            with torch.no_grad():
                answer = self.model(batch)
            # Upstream leaves the classifier's logits alone and squashes only
            # the regression values.
            direction = answer[:, FONT_COUNT : FONT_COUNT + 2]
            values = answer[:, FONT_COUNT + 2 :].sigmoid()

            for piece, head, value in zip(window, direction, values):
                measured.append(
                    {
                        "vertical": bool(head.argmax().item()),
                        # How far apart the two logits are. Not a probability
                        # and deliberately not softmaxed into one: a caller
                        # needs to know whether the model committed, and on a
                        # crop holding a single character it does not.
                        "margin": float((head.max() - head.min()).item()),
                        **_typography(value, piece.width),
                    }
                )
        return measured


def _typography(value: Any, width: int) -> dict[str, Any]:
    """The regression head, in the units a page is measured in.

    ⚠️ Everything spatial is a share of the crop's *width*, which is how it was
    fitted — the line spacing included, which is why the leading below is
    derived from it rather than read off a head of its own.
    """
    size = float(value[SIZE].item()) * width
    spacing = float(value[LINE_SPACING].item()) * width
    return {
        "fontSizePx": size,
        "strokeWidthPx": float(value[STROKE_WIDTH].item()) * width,
        # Upstream stores the gap between two lines; everything downstream
        # counts leading from one baseline to the next, so the type size goes
        # back in.
        "leadingPercent": (100.0 * (1.0 + spacing / size)) if size > 0 else FALLBACK_LEADING,
        "angleDeg": (float(value[ANGLE].item()) - 0.5) * 180.0,
        "color": _hex(value[COLOR]),
        "strokeColor": _hex(value[STROKE_COLOR]),
    }


def _hex(channels: Any) -> str:
    return "#" + "".join(f"{round(max(0.0, min(1.0, float(c.item()))) * 255):02x}" for c in channels)
