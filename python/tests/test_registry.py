"""`Registry.held()` — the weights stay alive for exactly the span they are used.

The bug this guards against: two pages reading with the same model in
parallel both pass the "is it loaded" check, both receive the same object,
and whichever finishes first unloads it while the other is still mid-read.
`FakeModel.use()` below is the fake standing in for that read — it does not
just check once at the start, it polls `is_loaded()` for its whole span, the
same way real inference keeps reaching for `self.processor` throughout a
forward pass rather than only when it begins.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from shashoku_ocr import registry as registry_module
from shashoku_ocr.registry import Registry


class FakeModel:
    """A model that can report whether it was used after being unloaded.

    `is_loaded()` toggles like the real thing; `use()` is the stand-in for a
    forward pass, and it keeps checking `is_loaded()` for its whole duration
    rather than once at the start — a snapshot taken only at entry would miss
    an unload that lands halfway through, which is exactly the failure mode
    this file exists to catch.
    """

    def __init__(self) -> None:
        self._loaded = False
        self.load_calls = 0
        self.unload_calls = 0
        self.used_after_unload = False

    def load(self) -> None:
        self._loaded = True
        self.load_calls += 1

    def unload(self) -> None:
        self._loaded = False
        self.unload_calls += 1

    def is_loaded(self) -> bool:
        return self._loaded

    def cached(self) -> bool:
        return True

    def use(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if not self._loaded:
                self.used_after_unload = True
            time.sleep(0.001)


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> Registry:
    return Registry()


def seed(registry: Registry, monkeypatch: pytest.MonkeyPatch, name: str, model: FakeModel) -> None:
    """Registers a fake model directly, bypassing the module import
    `instance()` normally does for a real one.

    `instance()` only reaches its import branch when `name` is not yet in
    `self.models`, so pre-populating both `models` and `gates` here makes it
    return `model` without ever touching `importlib`. `MODELS` still needs
    the key — `instance()` checks membership before looking at `self.models`
    — but the module path inside it is never used.
    """
    monkeypatch.setitem(registry_module.MODELS, name, ("unused", "Unused"))
    registry.models[name] = model
    registry.gates[name] = threading.Lock()


def test_held_loads_uses_and_unloads_in_order(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = FakeModel()
    seed(registry, monkeypatch, "m", model)

    with registry.held("m") as borrowed:
        assert borrowed is model
        assert model.is_loaded()

    assert model.load_calls == 1
    assert model.unload_calls == 1
    assert not model.is_loaded()


def test_held_unloads_even_when_the_block_raises(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = FakeModel()
    seed(registry, monkeypatch, "m", model)

    with pytest.raises(ValueError):
        with registry.held("m"):
            raise ValueError("boom")

    assert model.unload_calls == 1
    assert not model.is_loaded()


def test_load_get_unload_protocol_still_works(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`op:"load"` / `op:"unload"` on the wire go straight to these three
    methods (see `server.py`'s `dispatch`) — `held()` is an addition, not a
    replacement."""
    model = FakeModel()
    seed(registry, monkeypatch, "m", model)

    registry.load("m")
    assert registry.get("m") is model
    assert registry.unload("m") is True
    assert not model.is_loaded()


def test_two_requests_for_the_same_model_do_not_overlap(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The regression this ticket fixes: page A and page B both ask for the
    same model at once. Without the lock held across use, whichever finishes
    first unloads while the other is still reading — this is that race,
    reproduced with two spans of very different lengths so that under the
    broken shape the short one is guaranteed to finish, and unload, while the
    long one is still in its loop.
    """
    model = FakeModel()
    seed(registry, monkeypatch, "m", model)

    def short() -> None:
        with registry.held("m") as borrowed:
            borrowed.use(0.02)

    def long() -> None:
        with registry.held("m") as borrowed:
            borrowed.use(0.2)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(long), pool.submit(short)]
        for future in futures:
            future.result(timeout=5.0)

    assert model.used_after_unload is False


def test_different_models_run_side_by_side(
    registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Per-model locks must stay per-model: two different models must not
    wait on each other. Proven with a barrier both sides have to reach —
    if the registry ever serialized unrelated models, one side would sit
    inside its still-held lock waiting at the barrier for a partner that can
    never arrive, and `barrier.wait()` times out rather than the test
    hanging forever.
    """
    model_a = FakeModel()
    model_b = FakeModel()
    seed(registry, monkeypatch, "a", model_a)
    seed(registry, monkeypatch, "b", model_b)

    barrier = threading.Barrier(2, timeout=5.0)

    def run(name: str) -> None:
        with registry.held(name):
            barrier.wait()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, "a"), pool.submit(run, "b")]
        for future in futures:
            future.result(timeout=10.0)
