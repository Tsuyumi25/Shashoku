"""Weights that are a file at a URL rather than a repository on the hub.

Most of what this sidecar loads is a hub repository, and `weights` says how those
are pinned. A few are a single file published as a release asset, which has no
revision to name — the URL *is* the version, because a release asset cannot be
replaced without the checksum moving. So the checksum is what gets pinned, and a
file whose digest does not match is treated as no file at all.

Cached beside the hub's own cache, under whatever `HF_HOME` says, so that the one
knob a person already sets to move model downloads off their system disk moves
these too.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path


def cache_dir() -> Path:
    home = os.environ.get("HF_HOME")
    root = Path(home) if home else Path.home() / ".cache" / "huggingface"
    return root / "shashoku-assets"


def cached_path(url: str) -> Path:
    return cache_dir() / url.rsplit("/", 1)[-1]


def digest(path: Path) -> str:
    reader = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            reader.update(block)
    return reader.hexdigest()


def is_cached(url: str, md5: str) -> bool:
    """Whether this exact file is already here.

    The digest is read every time rather than trusted from a marker file. It
    costs a few hundred milliseconds on two hundred megabytes, and it is the only
    thing standing between a download cut off halfway and a model that loads to
    garbage.
    """
    path = cached_path(url)
    return path.is_file() and digest(path) == md5


def fetch(url: str, md5: str) -> Path:
    """The file, downloading it first if it is not already here.

    Written to a neighbouring temporary file and renamed into place, so a
    download interrupted at any point leaves nothing that looks finished.
    """
    path = cached_path(url)
    if is_cached(url, md5):
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    handle, staged = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    os.close(handle)
    staging = Path(staged)
    try:
        with urllib.request.urlopen(url) as source, staging.open("wb") as sink:
            shutil.copyfileobj(source, sink, length=1 << 20)
        got = digest(staging)
        if got != md5:
            raise ValueError(f"{url} came down as md5 {got}, expected {md5}")
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)
    return path
