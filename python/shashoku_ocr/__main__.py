"""Entry point for the OCR sidecar.

Run as `python -m shashoku_ocr`. Speaks JSON lines on stdin/stdout and writes
everything else to stderr.
"""

from __future__ import annotations

import os
import sys
from typing import IO


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

    return serve(utf8_stdin(), channel)


if __name__ == "__main__":
    raise SystemExit(main())
