"""LaMa, retrained on manga and anime.

One weight file, four ways of shipping it, and ten of the projects in this space
converge on it — `dreMaz/AnimeMangaInpainting`, big-lama fine-tuned on 300k
manga and anime pages by the author of BallonsTranslator. What loads here is the
TorchScript trace that IOPaint, PanelCleaner, comic-translate and ComfyUI's
art-venture nodes all load, so a result that looks wrong is the model's and not
this file's.

⚠️ There is an ONNX conversion of the same training run
(`ogkalu/lama-manga-onnx-dynamic`) which would run on the onnxruntime already
beside us and reach a GPU without torch. It is not the same numbers: the
conversion rewrote the Fourier unit LaMa's architecture is built around, and
nobody has compared the two outputs. Reference first, faster later.

The network takes the whole rectangle it is given and answers with the whole
rectangle. Which part of that answer is kept is the caller's business — this
returns the picture, not a decision.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from ..assets import fetch, is_cached

URL = (
    "https://github.com/Sanster/models/releases/download/"
    "AnimeMangaInpainting/anime-manga-big-lama.pt"
)
MD5 = "29f284f36a0a510bcacf39ecf4c4d54f"

# The trace is fully convolutional and downsamples three times, so a side that is
# not a multiple of eight comes back a different size than it went in.
PAD_MOD = 8


def pad_to(array: np.ndarray, mod: int) -> np.ndarray:
    """Room on the right and the bottom, mirrored rather than blank.

    Reflected because a black margin is an edge the network can see, and an edge
    it can see is one it draws towards.
    """
    height, width = array.shape[:2]
    down = (mod - height % mod) % mod
    right = (mod - width % mod) % mod
    if down == 0 and right == 0:
        return array
    spread = [(0, down), (0, right)] + [(0, 0)] * (array.ndim - 2)
    return np.pad(array, spread, mode="symmetric")


class AnimeLaMa:
    def __init__(self) -> None:
        self.model = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def cached(self) -> bool:
        return is_cached(URL, MD5)

    def load(self) -> None:
        import torch

        path = fetch(URL, MD5)
        # `map_location` rather than a device: everything here runs on the CPU
        # for now, and a trace saved from a CUDA machine refuses to load onto a
        # machine without one unless it is told where to put itself.
        self.model = torch.jit.load(str(path), map_location="cpu").eval()

    def unload(self) -> None:
        import gc

        self.model = None
        gc.collect()

    def inpaint(self, image_path: str, mask_path: str) -> Image.Image:
        """The rectangle, redrawn wherever the mask covers.

        `image` is the picture as it stands and `mask` is coverage over the same
        rectangle — anything above zero counts, because the network wants a hole,
        not a weighting. Feathering belongs to whoever composites the answer.
        """
        import torch

        if self.model is None:
            raise RuntimeError("anime-lama has not been loaded")

        picture = Image.open(image_path).convert("RGB")
        coverage = Image.open(mask_path).convert("L")
        if coverage.size != picture.size:
            raise ValueError(
                f"mask is {coverage.size[0]}×{coverage.size[1]} for a "
                f"{picture.size[0]}×{picture.size[1]} image"
            )
        width, height = picture.size

        image = np.asarray(picture, dtype=np.float32) / 255.0
        mask = (np.asarray(coverage) > 0).astype(np.float32)

        batch = torch.from_numpy(pad_to(image, PAD_MOD).transpose(2, 0, 1)).unsqueeze(0)
        holes = torch.from_numpy(pad_to(mask, PAD_MOD)).unsqueeze(0).unsqueeze(0)

        with torch.no_grad():
            answer = self.model(batch, holes)

        out = answer[0].permute(1, 2, 0).detach().cpu().numpy()
        out = np.clip(out * 255, 0, 255).astype(np.uint8)
        return Image.fromarray(out[:height, :width])
