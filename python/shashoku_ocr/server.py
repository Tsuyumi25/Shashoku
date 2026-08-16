"""The request loop.

One JSON object per line in, one per line out, matched by `id`. Replies are not
ordered: a request that takes a second does not hold up a `ping` behind it, and
the caller pairs answers by id anyway.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import IO, Any

from .registry import Registry

# Enough to let the three models run at once with a page's worth of crops in
# flight. Torch releases the GIL inside its kernels, so these are real threads
# doing real work rather than taking turns.
WORKERS = 4


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


class Server:
    def __init__(self, out: IO[str]) -> None:
        self.out = out
        self.registry = Registry()
        self.writing = threading.Lock()
        self.stopping = threading.Event()

    def reply(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False)
        with self.writing:
            self.out.write(line + "\n")
            self.out.flush()

    def handle(self, request: dict[str, Any]) -> None:
        request_id = request.get("id")
        try:
            result = self.dispatch(request)
        except Exception as error:  # noqa: BLE001 - every failure is the caller's to see
            log(traceback.format_exc())
            self.reply({"id": request_id, "ok": False, "error": f"{type(error).__name__}: {error}"})
        else:
            self.reply({"id": request_id, "ok": True, "result": result})

    def dispatch(self, request: dict[str, Any]) -> Any:
        op = request.get("op")

        if op == "ping":
            return {"pong": True}

        if op == "models":
            return self.registry.describe()

        if op == "load":
            return {"elapsedMs": self.registry.load(request["model"])}

        if op == "unload":
            return {"unloaded": self.registry.unload(request["model"])}

        if op == "detect":
            model = self.registry.get(request["model"])
            return {"boxes": model.detect(request["image"], request.get("minScore"))}

        if op == "read":
            model = self.registry.get(request["model"])
            return {"lines": model.read(request["image"], request["boxes"])}

        if op == "shutdown":
            self.stopping.set()
            return {"bye": True}

        raise ValueError(f"unknown op: {op!r}")


def serve(source: IO[str], out: IO[str]) -> int:
    server = Server(out)
    log("shashoku-ocr sidecar ready")

    with ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="ocr") as pool:
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as error:
                log(f"ignoring unparseable line: {error}")
                continue
            pool.submit(server.handle, request)
            if server.stopping.is_set():
                break

    # Falling out of the loop means stdin reached end of file, which is what
    # happens when whoever spawned this stopped existing. Nothing above us is
    # listening any more, so there is no one left to serve.
    log("stdin closed, exiting")
    return 0
