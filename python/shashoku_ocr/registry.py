"""Which models exist, and whether each one is in memory right now.

Loading is never implicit. A model that has not been loaded raises rather than
loading itself, because the moment weights enter memory is a moment someone
waits for, and deciding when that happens belongs to whoever is waiting.
"""

from __future__ import annotations

import importlib
import threading
import time
from typing import Any, Protocol


class Model(Protocol):
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def is_loaded(self) -> bool: ...
    def cached(self) -> bool: ...


# Imported by name rather than at module scope: every one of these pulls in
# torch, and a sidecar that has been asked for nothing should have paid for
# nothing.
MODELS: dict[str, tuple[str, str]] = {
    "bubble": ("shashoku_ocr.models.bubble", "BubbleDetector"),
    "layout": ("shashoku_ocr.models.layout", "LayoutDetector"),
    "mangaocr": ("shashoku_ocr.models.mangaocr", "MangaOcrReader"),
    "baberu": ("shashoku_ocr.models.baberu", "BaberuReader"),
    "hayai": ("shashoku_ocr.models.hayai", "HayaiReader"),
    "ppocr": ("shashoku_ocr.models.ppocr", "PpOcrReader"),
}


class Registry:
    def __init__(self) -> None:
        self.models: dict[str, Any] = {}
        self.book = threading.Lock()
        # A lock per model rather than one for all of them. Two calls to load
        # the same model arrive whenever a page fans out and the second must
        # wait for the first, but two *different* models loading at once is the
        # whole point of running them side by side.
        self.gates: dict[str, threading.Lock] = {}

    def instance(self, name: str) -> Any:
        if name not in MODELS:
            raise KeyError(f"unknown model: {name!r}")
        with self.book:
            if name not in self.models:
                module_name, class_name = MODELS[name]
                module = importlib.import_module(module_name)
                self.models[name] = getattr(module, class_name)()
                self.gates[name] = threading.Lock()
            return self.models[name]

    def get(self, name: str) -> Any:
        model = self.instance(name)
        # Waits rather than refusing when a load of this model is already in
        # flight: a caller that asked for a page and then for its crops has not
        # done anything wrong, and the answer it wants exists a moment later.
        with self.gates[name]:
            if not model.is_loaded():
                raise RuntimeError(f"model {name!r} is not loaded")
        return model

    def load(self, name: str) -> float:
        model = self.instance(name)
        started = time.perf_counter()
        with self.gates[name]:
            if not model.is_loaded():
                model.load()
        return (time.perf_counter() - started) * 1000

    def unload(self, name: str) -> bool:
        model = self.models.get(name)
        if model is None:
            return False
        with self.gates[name]:
            if not model.is_loaded():
                return False
            model.unload()
        return True

    def describe(self) -> list[dict[str, Any]]:
        """Every model, whether it is in memory, and whether asking for it
        would reach the network first."""
        state = []
        for name in sorted(MODELS):
            model = self.instance(name)
            state.append(
                {"model": name, "loaded": model.is_loaded(), "cached": bool(model.cached())}
            )
        return state
