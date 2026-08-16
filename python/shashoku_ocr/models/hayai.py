"""hayai-ocr-v2, through the classes its author hosts beside the weights.

Its encoder keeps the crop's aspect ratio instead of squaring it off, which is
the one thing manga-ocr's ViT cannot do — and onomatopoeia are exactly where
aspect ratios go extreme.

⚠️ The image processor is somebody else's. The repository ships no
`preprocessor_config.json`; its encoder *is* `google/siglip2-base-patch16-naflex`
and the model card reaches for that repository by name, so this does too. Only
the processor files come down, not that model's weights.

⚠️ `max_num_patches` is the resolution knob, and higher is not better here.
Measured on the forty-six hand-cut onomatopoeia: 256 reads twenty of them, 512
reads thirteen, 1024 reads eight. The author's own default is the best of the
three by a wide margin, so it is not exposed as an argument — a caller reaching
for a bigger number would be reaching for a worse reading.
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from ..crop import crops
from ..weights import hub_cached, pinned

REPO = "JustANormalTinkerer/hayai-ocr-v2"
REVISION = "c0e7a9c767299c565bdd7dd3f628a61735886454"
# Named rather than derived: this is the encoder the weights were trained
# against, and a later SigLIP2 variant would silently normalise differently.
PROCESSOR = "google/siglip2-base-patch16-naflex"
PROCESSOR_REVISION = "b53b807d3a2d5e2b3911292f2d69e5341cdc064c"

MAX_PATCHES = 256
MAX_NEW_TOKENS = 128
# The author's package ships 1.00 and the model card 1.20. Measured on the same
# forty-six crops the two are indistinguishable, so the card's value stands.
REPETITION_PENALTY = 1.2


class HayaiReader:
    def __init__(self) -> None:
        self.model: Any = None
        self.tokenizer: Any = None
        self.processor: Any = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def cached(self) -> bool:
        # Both, because the processor is a repository of its own: an answer of
        # yes that covered only the weights would promise no download and then
        # go and fetch four hundred megabytes of SigLIP.
        return hub_cached(REPO, REVISION) and hub_cached(PROCESSOR, PROCESSOR_REVISION)

    def load(self) -> None:
        from transformers import AutoModel, AutoProcessor, PreTrainedTokenizerFast

        # The architecture lives in `modeling_hayai.py` next to the weights, so
        # there is code here to run and the flag is the point rather than a
        # formality.
        weights = pinned(REPO, REVISION)
        self.model = AutoModel.from_pretrained(REPO, trust_remote_code=True, **weights).eval()
        self.tokenizer = PreTrainedTokenizerFast.from_pretrained(REPO, **weights)
        self.processor = AutoProcessor.from_pretrained(
            PROCESSOR, **pinned(PROCESSOR, PROCESSOR_REVISION)
        )

    def unload(self) -> None:
        import gc

        import torch

        self.model = self.tokenizer = self.processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def read(self, image_path: str, boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        import torch

        page = Image.open(image_path)
        device = next(self.model.parameters()).device
        lines = []

        for piece in crops(page, boxes):
            inputs = self.processor(
                images=[piece.convert("RGB")], max_num_patches=MAX_PATCHES, return_tensors="pt"
            )
            # The author's `generate` answers with decoded strings and keeps its
            # logits to itself, so they are taken off the output head on the way
            # past. A hook rather than a copy of the loop: that loop is a
            # hand-written KV cache the author is free to rewrite, and every
            # line of it reproduced here would be a line to keep in step.
            steps: list[Any] = []
            handle = self.model.decoder.output_head.register_forward_hook(
                lambda _m, _i, out: steps.append(out.detach())
            )
            try:
                with torch.no_grad():
                    said = self.model.generate(
                        pixel_values=inputs["pixel_values"].to(device),
                        pixel_attention_mask=inputs["pixel_attention_mask"].to(device),
                        spatial_shapes=inputs["spatial_shapes"].to(device),
                        tokenizer=self.tokenizer,
                        max_new_tokens=MAX_NEW_TOKENS,
                        repetition_penalty=REPETITION_PENALTY,
                    )
            finally:
                handle.remove()

            lines.append({"text": said[0].strip(), "confidence": self._sureness(steps)})

        return lines

    def _sureness(self, steps: list[Any]) -> float:
        """The geometric mean of the probability put on each character written.

        The same quantity the other two recognizers report, so that a reading
        from this model can be compared against theirs rather than merely
        ranked among its own. Decoding is greedy, so the character written at
        each step is the argmax of that step's logits and no realignment
        against the returned text is needed.

        ⚠️ Read off the logits rather than after the repetition penalty. The
        penalty exists to steer the writing; letting it also lower the reported
        number would report the model as unsure of the very character it was
        pushed towards.
        """
        import torch

        eos = self.tokenizer.eos_token_id
        pad = self.tokenizer.pad_token_id
        probabilities = []
        for step in steps:
            logits = step[0, -1, :].float()
            token = int(logits.argmax(-1))
            if token in (eos, pad):
                break
            probabilities.append(float(logits.log_softmax(-1)[token]))
        if not probabilities:
            return 0.0
        return float(torch.tensor(probabilities).mean().exp())
