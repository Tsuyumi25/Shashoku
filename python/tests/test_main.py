"""Tests for `shashoku_ocr.__main__.utf8_stdin`.

The guarantee under test: whatever this process reads from its request pipe
decodes as UTF-8, regardless of the host OS's locale codepage. On a Japanese
Windows install, a pipe (unlike a console) is opened with cp932, and that
silently corrupts most non-ASCII text — see `utf8_stdin`'s own docstring for
why this has to be fixed on our side rather than via an environment variable.
"""

from __future__ import annotations

import io

import pytest

from shashoku_ocr.__main__ import utf8_stdin

# Measured by hand: UTF-8 bytes fed through a stream that decodes as cp932,
# the system locale codepage a Japanese Windows install picks for a pipe.
# Only the last two of these nine raise `UnicodeDecodeError` under cp932 —
# the other seven decode to something, just the wrong something — so every
# assertion below has to compare content, never just "did it raise".
SAMPLES = [
    "田中",
    "漫画",
    "陳",
    "測試",
    "涼宮ハルヒ",
    "김철수",
    "abc",
    "Hello, World!",
    "12345",
]


def _cp932_pipe(text: str) -> io.TextIOWrapper:
    """Build the exact thing a Japanese-Windows pipe hands us: a text stream
    already decoding UTF-8 bytes as cp932.

    This is not a simulation of the Windows bug. `TextIOWrapper` wrapping a
    buffer with the system locale encoding is the same mechanism CPython
    uses for a real pipe on Windows — the only difference is the buffer
    underneath (`BytesIO` here vs. an OS pipe there), and `reconfigure()`
    cannot tell the difference either.
    """
    return io.TextIOWrapper(io.BytesIO(text.encode("utf-8")), encoding="cp932")


@pytest.mark.parametrize("text", SAMPLES)
def test_utf8_stdin_roundtrips(text: str) -> None:
    stream = _cp932_pipe(text)
    fixed = utf8_stdin(stream)
    assert fixed.read() == text


def test_utf8_stdin_defaults_to_sys_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    """`main()` calls `utf8_stdin()` with no argument; make sure that path
    reconfigures `sys.stdin` itself rather than being dead code only the
    parametrized test above exercises.
    """
    fake_stdin = _cp932_pipe("陳")
    monkeypatch.setattr("sys.stdin", fake_stdin)

    result = utf8_stdin()

    assert result is fake_stdin
    assert result.read() == "陳"
