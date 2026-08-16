"""Entry point for the OCR sidecar.

Run as `python -m shashoku_ocr`. Speaks JSON lines on stdin/stdout and writes
everything else to stderr.
"""

from __future__ import annotations

import os
import sys


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

    return serve(sys.stdin, channel)


if __name__ == "__main__":
    raise SystemExit(main())
