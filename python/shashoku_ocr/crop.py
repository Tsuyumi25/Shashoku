"""Cutting regions out of a page."""

from __future__ import annotations

from typing import Any, Iterable

from PIL import Image


def crop(page: Image.Image, box: dict[str, Any]) -> Image.Image:
    """The region, exactly as it was given.

    No allowance added here, though every recognizer does read better with air
    around the writing — measured against hand-labelled crops, a box drawn tight
    to the ink costs Baberu a third of its correct readings. That air belongs to
    whoever proposed the region: a caller pooling two detectors needs their boxes
    to mean the same thing, and it cannot make them agree if each reader quietly
    widens what it was handed.
    """
    x, y = float(box["x"]), float(box["y"])
    width, height = float(box["width"]), float(box["height"])
    left = max(0.0, x)
    top = max(0.0, y)
    right = min(float(page.width), x + width)
    bottom = min(float(page.height), y + height)
    return page.crop((int(left), int(top), max(int(right), int(left) + 1), max(int(bottom), int(top) + 1)))


def crops(page: Image.Image, boxes: Iterable[dict[str, Any]]) -> list[Image.Image]:
    return [crop(page, box) for box in boxes]
