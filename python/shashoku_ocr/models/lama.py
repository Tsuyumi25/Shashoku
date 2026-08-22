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

# ⚠️ What the model fills a hole with is a few levels off the tone around it —
# on flat artwork that reads as a visible patch. Measured here at 2 to 3 levels
# of 255 on a flat grey, and the same on all three of its published checkpoints,
# so it is the model's rather than this file's or a better mask's. Why it does
# it is not established, and nothing here needs it to be.
#
# The repair that suggests itself — measure the answer against the original
# where the mask does not cover, and correct by the difference — is a no-op
# here, and reading the trace is the only way to find that out: it composites
# internally, returning `mask * generated + (1 - mask) * original`. Outside the
# mask its answer is the input, bit for bit, so anything measured there is the
# identity and any correction derived from it is zero.
#
# So the generator is called directly and the compositing done here, which makes
# the whole of its answer visible — including where it lands outside the mask,
# where the original says what it should have been.

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

# Sweeps of the correction field, coarse then fine. Enough that the rim's level
# has reached the middle of a hole the size text leaves; more buys nothing,
# because what is being solved for is nearly flat to begin with.
COARSE_SWEEPS = 400
FINE_SWEEPS = 800


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


def levelled(answer: np.ndarray, image: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """`answer` lifted onto the tone of the picture around the hole.

    Only the low frequencies move. The correction is the answer's own error
    where the original is there to measure it — everywhere outside the hole —
    carried inward as the smoothest field that agrees with it at the rim, which
    is a harmonic function and so has no detail of its own to add. Every edge
    the network drew survives untouched, including the ones between two regions
    it filled differently: a gradient is unchanged by adding a field that has
    almost none, and each region's level follows from the rim it meets.

    Preferred over fitting a curve from value to correction, which was the other
    candidate and measures worse: over ten regions of one page the rim-led field
    left at worst a single level of 255, where the fitted curve left three. The
    reading that goes with that — the error being a function of place rather
    than of value — is only a reading; the numbers are what the choice rests on.

    Nothing to lean on when the hole reaches every edge — the field stays zero
    and the answer is returned as it came, which is the honest outcome rather
    than a guess.
    """
    inside = hole > 0.5
    if inside.all():
        return answer

    gap = (image - answer).astype(np.float32)
    field = np.zeros_like(gap)
    # Coarse first. The correction is by construction the flattest thing that
    # fits the rim, and a flat thing crosses a fine grid one pixel per sweep —
    # thousands of sweeps at full size, tens on a quarter-size one.
    small = np.asarray(
        Image.fromarray((inside * 255).astype(np.uint8)).resize(
            (max(2, inside.shape[1] // 4), max(2, inside.shape[0] // 4)), Image.NEAREST
        )
    ) > 127

    def relax(guess: np.ndarray, rim: np.ndarray, mask: np.ndarray, sweeps: int) -> np.ndarray:
        for _ in range(sweeps):
            spread = np.zeros_like(guess)
            spread[1:-1, 1:-1] = (
                guess[:-2, 1:-1] + guess[2:, 1:-1] + guess[1:-1, :-2] + guess[1:-1, 2:]
            ) * 0.25
            guess = np.where(mask, spread, rim)
        return guess

    for channel in range(gap.shape[2]):
        rim = gap[..., channel]
        coarse = np.asarray(Image.fromarray(rim).resize(small.shape[::-1], Image.BILINEAR))
        coarse = relax(np.where(small, 0.0, coarse), coarse, small, COARSE_SWEEPS)
        seeded = np.asarray(Image.fromarray(coarse).resize(rim.shape[::-1], Image.BILINEAR))
        field[..., channel] = relax(np.where(inside, seeded, rim), rim, inside, FINE_SWEEPS)

    return answer + field


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

        generator = self.generator()
        with torch.no_grad():
            if generator is None:
                answer = self.model(batch, holes)
                raw = answer[0].permute(1, 2, 0).detach().cpu().numpy()[:height, :width]
                out = raw
            else:
                answer = generator(torch.cat([batch * (1 - holes), holes], 1))
                raw = answer[0].permute(1, 2, 0).detach().cpu().numpy()[:height, :width]
                lifted = levelled(raw, image, mask)
                # The composite the trace would have done, done here so that the
                # correction sits between the two. Outside the hole the original
                # is returned untouched — the correction is measured there, not
                # applied there.
                out = np.where(mask[..., None] > 0.5, lifted, image)

        # Rounded rather than truncated. Casting alone takes half a level off
        # every pixel, which on the flat tones this model is used against is a
        # bias in the same direction as the one above.
        return Image.fromarray(np.clip(out * 255, 0, 255).round().astype(np.uint8))

    def generator(self):
        """The network inside the trace, or None if this checkpoint hides it.

        ⚠️ Reaching through the trace's own structure, which is not a promise
        anybody made: `model.generator` is where the published checkpoint keeps
        it, and a re-export with a different wrapper would not. Missing it costs
        the tone correction and nothing else, so it is a check rather than a
        requirement — a repair a few levels off is better than no repair.
        """
        return getattr(getattr(self.model, "model", None), "generator", None)
