"""Entry point for the OCR sidecar.

Run as `python -m shashoku_ocr`. Speaks JSON lines on stdin/stdout and writes
everything else to stderr.
"""

from __future__ import annotations

import codecs
import ctypes.wintypes
import os
import sys
import time
from typing import IO, Callable, Iterable, Iterator


def utf8_stdin(stream: IO[str] | None = None) -> IO[str]:
    """Reconfigure a text stream (default: `sys.stdin`) to decode UTF-8.

    We are always talking to a pipe here, never an interactive console:
    Electron spawns this process and writes requests to our stdin over a
    pipe, it never hands us a terminal. On Windows, Python's own docs say a
    pipe (unlike a real console) "use[s] the system locale encoding (i.e.
    the ANSI codepage)" rather than UTF-8. On a Japanese Windows install
    that is cp932, which silently corrupts most non-ASCII text it decodes
    and only raises on the rest — and the text most likely to carry
    non-ASCII bytes is the user's own Windows account name, which shows up
    in paths such as `%LOCALAPPDATA%`.

    We cannot fix this by asking whoever launches us to set an environment
    variable instead. `PYTHONUTF8=1` only changes the encoding Python picks
    when it *opens* `sys.stdin`, so it has to be set in the parent process
    before this interpreter starts; by the time this function runs that
    window has already closed. Reconfiguring here makes the guarantee
    travel with this module regardless of how it gets invoked — including
    being run directly for development or under a test runner — rather than
    depending on the launcher remembering to set the variable correctly.
    (The launcher does set `PYTHONUTF8=1` too, as defense in depth for the
    interpreter's other I/O; that is a separate change, not a substitute
    for this one.)

    Split out from `main()` so a test can call it on its own, without also
    having to reproduce the fd surgery that `main()` performs around
    stdout.
    """
    if stream is None:
        stream = sys.stdin
    stream.reconfigure(encoding="utf-8")
    return stream


# How long to sleep between `PeekNamedPipe` polls when stdin has nothing
# waiting yet. This is the only knob in `PolledPipeLines`, so it earns its
# own name: it is the answer to "how much later can a request start than it
# would have under a blocking read", and the honest answer has to be judged
# against what a request actually costs, not against zero. A page of OCR
# measured at 28 seconds; 10ms added once per request is three orders of
# magnitude below that, not a fraction worth trading against the deadlock
# below.
POLL_INTERVAL_SECONDS = 0.01

# The two Win32 errors that mean the writing end has gone away, as opposed to
# the call itself having failed. Treating every failure as end-of-input — which
# is what returning `None` unconditionally did — hands the same verdict to a
# bad handle, an exhausted resource, and a peer that closed cleanly, so a real
# fault arrives disguised as a tidy shutdown that nobody investigates.
ERROR_BROKEN_PIPE = 109
ERROR_PIPE_NOT_CONNECTED = 233
PEER_GONE_ERRORS = frozenset({ERROR_BROKEN_PIPE, ERROR_PIPE_NOT_CONNECTED})


class PolledPipeLines(Iterator[str]):
    """Assembles request lines from a pipe without ever sitting inside a
    blocking read — the fix for a deadlock that was measured, not guessed.

    The story, in the order it was found: a user presses "recognize" and the
    UI sticks on the very first station, "find bubbles", with the sidecar
    process reporting 0% CPU, 0% network, and 22 MB resident. 22 MB is the
    damning number — `torch` alone is several hundred MB once it is in
    memory, so the process had not even finished *importing* it. Dumping
    every thread's stack showed the main thread parked in `for line in
    source` (a blocking read on stdin) while a worker thread was stuck
    inside `create_module` for a `.pyd` — a native extension's loader,
    never returning.

    Six measurements pinned the trigger down:

      - main thread `sleep()`, worker `import numpy`             → 0.08s
      - main thread blocked in a pipe *read*, worker `import numpy` → still
        not back after 60s
      - worker does five heartbeats before importing                → all
        five arrive on time, so the worker thread itself is not starved (not
        a GIL problem)
      - worker imports a pure-Python module instead of numpy        → 0.01s,
        so it is native-extension loading specifically that hangs, not
        `import` in general
      - poking the blocked pipe with one more line, so the read wakes up →
        the stuck load finishes immediately, in 8.29s
      - the same hang reproduces with a single request; concurrency is not
        a factor

    And two guesses that turned out wrong: it is not "the main thread"
    specifically — moving the read to a worker thread and leaving the main
    thread parked on `Event.wait()` still hangs, so the real condition is
    "any thread blocked in a pipe read", full stop. And warming the native
    extensions up ahead of time does not help either — measured with no
    warmup, with numpy warmed, and with numpy+torch+transformers all warmed,
    all three still stuck at the first station, because there is always some
    *other* native extension being loaded for the first time somewhere in
    that stack.

    This was never hit in development because `python -m shashoku_ocr <
    request.jsonl` reads a file, which reaches EOF and lets the main thread
    fall out of the loop into the thread pool's teardown wait — a different
    wait, not a pipe read, so it never triggers this. A live pipe from
    Electron never reaches EOF on its own; that is the entire difference.

    Which lock is actually shared between a pipe read and `LoadLibrary` was
    never pinned down — that lives inside Win32, below what Python can see.
    The nearest known relative is CPython's own
    `LoadLibraryExW called with GIL held can cause deadlock`
    (python/cpython#78076, fixed in 2018 by releasing the GIL before the
    call), and third-party prior art (`JustVugg/colibri`) documents the same
    shape in one sentence: "on Windows, reading two child pipes
    simultaneously deadlocks CPython's IO." The fix below does not depend on
    naming that lock — it attacks the proven trigger (a thread parked inside
    a blocking pipe read) rather than the unproven mechanism.

    So: never call a blocking read on the pipe. Ask `PeekNamedPipe` how many
    bytes are waiting; if none, sleep `POLL_INTERVAL_SECONDS` and ask again;
    once some are waiting, read exactly that many (never more — asking for
    more than is available is itself a blocking read) and hand them to an
    incremental UTF-8 decoder, since a byte batch can end in the middle of a
    multi-byte character. `peek` and `read` are injected rather than called
    directly against `ctypes.windll` so this class — the actual polling and
    line-assembly logic — can be exercised against a fake pipe on Linux; only
    `win32_pipe_source` below needs a real Windows pipe, and it is a thin
    enough wrapper that it does not need its own tests.
    """

    def __init__(
        self,
        peek: Callable[[], int | None],
        read: Callable[[int], bytes],
        poll_interval: float = POLL_INTERVAL_SECONDS,
    ) -> None:
        self._peek = peek
        self._read = read
        self._poll_interval = poll_interval
        self._decoder = codecs.getincrementaldecoder("utf-8")()
        self._buffer = ""
        self._peer_gone = False

    def __iter__(self) -> "PolledPipeLines":
        return self

    def __next__(self) -> str:
        while True:
            if "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                return line + "\n"

            if self._peer_gone:
                # Mirrors what a normal blocked-read iterator does at EOF: a
                # final line with no trailing newline is still a line, not
                # silence. Once this fires there is nothing left to poll for
                # ever again, so it is checked before touching `_peek` again.
                if self._buffer:
                    line, self._buffer = self._buffer, ""
                    return line
                raise StopIteration

            available = self._peek()
            if available is None:
                # `None` is `peek`'s word for "the peer closed its end", and
                # only that. Anything else that goes wrong down there is
                # raised instead of returned, and is deliberately left to
                # travel: a failure disguised as a clean end of input is a
                # failure nobody goes looking for.
                self._peer_gone = True
                continue

            if available == 0:
                # The one line this whole class exists to make true: an
                # empty pipe puts this thread to sleep, never into a read.
                time.sleep(self._poll_interval)
                continue

            chunk = self._read(available)
            if not chunk:
                self._peer_gone = True
                continue
            self._buffer += self._decoder.decode(chunk)


def win32_pipe_source() -> tuple[Callable[[], int | None], Callable[[int], bytes]] | None:
    """Build the real `peek`/`read` pair for stdin's `PeekNamedPipe`, or
    `None` if stdin's handle does not answer to it at all.

    A handle that does not answer *the opening probe* is not an error case to
    recover from — it is Windows telling us stdin is a redirected file or a
    console rather than a pipe, and `for line in stream` was already correct
    for both of those; only a live pipe can deadlock the way
    `PolledPipeLines` exists to avoid. Once that probe has succeeded, though,
    the same failure means something else entirely, and the returned `peek`
    says so: `None` only for the two errors that mean the peer is gone, and
    an exception for everything else.
    """
    import msvcrt

    fd = 0
    handle = msvcrt.get_osfhandle(fd)
    # `use_last_error=True` gives ctypes its own copy of `GetLastError` for
    # each call into this library, rather than leaving us to read a
    # thread-global that any ctypes call in between could have overwritten.
    # Built here rather than at import time because `ctypes.WinDLL` does not
    # exist off Windows, and this module is imported on Linux by its tests.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]

    # Declared rather than left to ctypes' defaults. An undeclared integer
    # argument is marshalled as a C `int`, and a HANDLE on 64-bit Windows is
    # pointer-sized; Windows happens to keep handle values inside 32 bits, so
    # this has been working by permission rather than by contract.
    kernel32.PeekNamedPipe.argtypes = [
        ctypes.wintypes.HANDLE,
        ctypes.c_void_p,
        ctypes.wintypes.DWORD,
        ctypes.POINTER(ctypes.wintypes.DWORD),
        ctypes.POINTER(ctypes.wintypes.DWORD),
        ctypes.POINTER(ctypes.wintypes.DWORD),
    ]
    kernel32.PeekNamedPipe.restype = ctypes.wintypes.BOOL

    def peek() -> int | None:
        held = ctypes.wintypes.DWORD()
        if kernel32.PeekNamedPipe(handle, None, 0, None, ctypes.byref(held), None):
            return held.value
        code = ctypes.get_last_error()
        if code in PEER_GONE_ERRORS:
            return None
        raise ctypes.WinError(code)  # type: ignore[attr-defined]

    def read(size: int) -> bytes:
        return os.read(fd, size)

    # The probe is the one place where every failure means the same thing, so
    # it is the one place that swallows them all.
    try:
        if peek() is None:
            return None
    except OSError:
        return None
    return peek, read


def request_lines(
    stream: IO[str],
    *,
    platform: str = sys.platform,
    pipe_source: Callable[[], tuple[Callable[[], int | None], Callable[[int], bytes]] | None] = win32_pipe_source,
) -> Iterable[str]:
    """Decide how the request loop should pull lines off `stream`.

    Everywhere except a real Windows pipe, this is just `stream` — the
    ordinary blocking iteration `serve()` has always done, which is correct
    and cheap when stdin is a file (tests, `python -m shashoku_ocr <
    req.jsonl`) or a console. Only when both conditions hold — the platform
    is Windows *and* `PeekNamedPipe` actually answers, meaning stdin is a
    live pipe — does this switch to `PolledPipeLines`. `platform` and
    `pipe_source` are constructor-injected so a test can exercise the
    decision itself without needing an actual Windows pipe.
    """
    if platform != "win32":
        return stream

    source = pipe_source()
    if source is None:
        return stream

    peek, read = source
    return PolledPipeLines(peek, read)


def main() -> int:
    # Hugging Face draws progress bars on stdout the moment it is imported, so
    # this has to be set before anything reaches for it rather than beside the
    # code that downloads.
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

    # The protocol owns stdout, but torch, transformers and their dependencies
    # all print to it uninvited, and one banner line is enough to make the
    # stream unparseable. Duplicating the descriptor away and pointing
    # `sys.stdout` at stderr means anything printed later is merely noise in
    # the log instead of a corrupt frame.
    protocol_fd = os.dup(1)
    os.dup2(2, 1)
    channel = os.fdopen(protocol_fd, "w", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr

    from .server import serve

    return serve(request_lines(utf8_stdin()), channel)


if __name__ == "__main__":
    raise SystemExit(main())
