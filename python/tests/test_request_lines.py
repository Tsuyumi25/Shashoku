"""Tests for `shashoku_ocr.__main__.PolledPipeLines` and `request_lines`.

The bug this guards against: on Windows, a thread blocked inside a *pipe*
read (not a file read — `python -m shashoku_ocr < req.jsonl` never triggers
this) stops every native extension anywhere in the process from finishing
its `LoadLibrary` call. The measured chain, condensed to what a test can
assert: a thread parked in a blocking pipe read hangs forever; a thread that
gets to sleep-and-retry instead does not; and once one more line arrives on
the pipe, work that had been stuck for 60 seconds finishes in under a
second. `PolledPipeLines.__init__`'s docstring in `__main__.py` carries the
full measured story — the six experiments and the two guesses that turned
out wrong — this file only carries what is testable from it.

Both `peek` and `read` are injected as plain callables, which is what makes
this runnable on Linux at all: nothing here touches `ctypes.windll` or
`msvcrt`, both of which do not exist off Windows (verified by hand — see
`FakePipe` below, which stands in for what a real `PeekNamedPipe` + `os.read`
pair would report).
"""

from __future__ import annotations

import time

import pytest

from shashoku_ocr.__main__ import POLL_INTERVAL_SECONDS, PolledPipeLines, request_lines


class FakePipe:
    """Script-driven stand-in for a Windows pipe's `PeekNamedPipe` + `read`.

    `peek()` consumes the next scripted event once whatever was previously
    peeked has been fully read:

      - `bytes`  → that many bytes are waiting
      - `0`      → nothing waiting *yet* — the peer is still connected, it
                   just has not written anything since the last poll
      - `None`   → `PeekNamedPipe` itself failed: the peer disappeared

    `read(size)` asserts `size` is exactly what the most recent `peek()`
    reported — the same discipline `PolledPipeLines` is required to keep
    (see the "要幾個位元組就讀幾個" acceptance criterion), enforced here
    rather than merely hoped for.
    """

    def __init__(self, script: list[bytes | int | None]) -> None:
        self._script = list(script)
        self._current: bytes | None = None
        self.read_calls: list[int] = []

    def peek(self) -> int | None:
        if self._current is not None:
            return len(self._current)
        if not self._script:
            # A script that runs out without an explicit `None` is a test
            # bug, not a real "peer still connected" — surface it as
            # disconnection rather than spinning forever.
            return None
        event = self._script.pop(0)
        if event is None:
            return None
        if event == 0:
            return 0
        self._current = event
        return len(self._current)

    def read(self, size: int) -> bytes:
        assert self._current is not None, "read() called with nothing peeked"
        assert size == len(self._current), (
            f"asked for {size} bytes but only {len(self._current)} were peeked as available"
        )
        self.read_calls.append(size)
        data, self._current = self._current, None
        return data


@pytest.fixture(autouse=True)
def no_real_sleeping(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Every test in this file replaces `time.sleep` with a recorder instead
    of skipping past it — the whole point of `POLL_INTERVAL_SECONDS` is that
    *something* sleeps there, so silently no-opping it would hide the one
    behavior most worth catching a regression in.
    """
    calls: list[float] = []
    monkeypatch.setattr(time, "sleep", lambda seconds: calls.append(seconds))
    return calls


def drain(reader: PolledPipeLines) -> list[str]:
    return list(reader)


def test_a_complete_line_in_one_batch() -> None:
    pipe = FakePipe([b"hello\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert next(reader) == "hello\n"


def test_a_half_line_split_across_batches() -> None:
    pipe = FakePipe([b"hel", b"lo\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert next(reader) == "hello\n"
    assert pipe.read_calls == [3, 3]


def test_one_batch_carries_multiple_lines() -> None:
    pipe = FakePipe([b"a\nb\nc\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert drain_n(reader, 3) == ["a\n", "b\n", "c\n"]
    # All three lines came out of the one batch that was actually peeked —
    # asking again would have meant blocking on an empty pipe unnecessarily.
    assert pipe.read_calls == [6]


def drain_n(reader: PolledPipeLines, n: int) -> list[str]:
    return [next(reader) for _ in range(n)]


def test_cjk_character_split_mid_byte_sequence() -> None:
    # "陳" is 3 UTF-8 bytes (E9 99 B3). Splitting after the first 2 bytes
    # lands the cut inside the character itself, not on a character
    # boundary — the exact case a byte-oriented (non-incremental) decoder
    # would mangle or raise on.
    encoded = "陳\n".encode("utf-8")
    pipe = FakePipe([encoded[:2], encoded[2:]])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert next(reader) == "陳\n"


def test_disconnect_flushes_the_trailing_partial_line() -> None:
    """The peer disappearing mid-line must still surface that line — a
    blocking `for line in stream` yields a final unterminated line at EOF
    too, and losing it here would be new, silent data loss this change
    introduced rather than fixed.
    """
    pipe = FakePipe([b"partial", None])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert drain(reader) == ["partial"]


def test_disconnect_with_nothing_buffered_just_stops() -> None:
    pipe = FakePipe([b"complete\n", None])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert drain(reader) == ["complete\n"]


def test_empty_polls_sleep_and_never_call_read(no_real_sleeping: list[float]) -> None:
    """The reason this class exists: a round with nothing waiting must be a
    sleep, never a read of any size — including a zero-byte read, which on
    a real pipe is just as blocking as any other.
    """
    pipe = FakePipe([0, 0, 0, b"hi\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert next(reader) == "hi\n"
    assert no_real_sleeping == [POLL_INTERVAL_SECONDS] * 3
    assert pipe.read_calls == [3]  # never a 0-byte read


def test_empty_polls_use_the_named_interval(no_real_sleeping: list[float]) -> None:
    pipe = FakePipe([0, b"x\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read, poll_interval=0.5)

    next(reader)

    assert no_real_sleeping == [0.5]


def test_reads_never_ask_for_more_than_was_peeked() -> None:
    """`FakePipe.read` already asserts this on every call; this test just
    makes the property explicit as its own assertion so a future refactor
    that swaps `FakePipe` out cannot lose the check silently.
    """
    pipe = FakePipe([b"ab", b"cde", b"f\n"])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    next(reader)

    assert pipe.read_calls == [2, 3, 2]


def test_iterating_with_a_for_loop_works() -> None:
    """`serve()` does `for line in source`, not manual `next()` calls —
    prove `PolledPipeLines` actually satisfies that protocol end to end.
    """
    pipe = FakePipe([b"one\ntwo\n", b"thr", b"ee\n", None])
    reader = PolledPipeLines(pipe.peek, pipe.read)

    assert list(reader) == ["one\n", "two\n", "three\n"]


# --- request_lines: the platform/pipe decision itself -----------------------


def test_non_windows_always_uses_the_stream_directly() -> None:
    stream = object()  # never touched — the point is nothing calls into it

    def pipe_source() -> None:
        raise AssertionError("pipe_source must not be consulted off Windows")

    result = request_lines(stream, platform="linux", pipe_source=pipe_source)  # type: ignore[arg-type]

    assert result is stream


def test_windows_falls_back_when_peek_named_pipe_cannot_answer() -> None:
    """`pipe_source` returning `None` is what a redirected file or a console
    looks like on Windows — situations blocking iteration was already
    correct for, so `request_lines` must hand back the stream untouched
    rather than trying to poll something that was never a pipe.
    """
    stream = object()

    result = request_lines(stream, platform="win32", pipe_source=lambda: None)  # type: ignore[arg-type]

    assert result is stream


def test_windows_with_a_real_pipe_polls() -> None:
    pipe = FakePipe([b"hi\n", None])

    result = request_lines(
        object(),  # type: ignore[arg-type]
        platform="win32",
        pipe_source=lambda: (pipe.peek, pipe.read),
    )

    assert isinstance(result, PolledPipeLines)
    assert list(result) == ["hi\n"]
