"""Which version of a model's weights, and whether to ask the hub for them.

Two questions with one answer, because past the first run they are the same
question: a revision that is pinned is a revision already on the disk, and a
revision already on the disk has nothing to ask the hub about.

⭐ Both halves are load-bearing and neither substitutes for the other. Pinning
alone says which weights answered — without it, "the model I tested against" is
whatever the repository's default branch pointed at the day somebody first ran
it, which nothing records. Skipping the hub alone would freeze the machine on
whatever it happened to fetch first, which is the same drift with no name on it.
"""

from __future__ import annotations

from typing import Any


def hub_cached(repo: str, revision: str, **kwargs: Any) -> bool:
    """Whether this exact revision is already on this machine.

    Asked before anything is loaded, so the interface can say what a click is
    about to cost. Every route here downloads on first use, so the answer is
    never "you cannot" — it is "this will reach the network first".
    """
    from huggingface_hub import snapshot_download

    try:
        snapshot_download(repo, revision=revision, local_files_only=True, **kwargs)
    except Exception:
        return False
    return True


def pinned(repo: str, revision: str, **kwargs: Any) -> dict[str, Any]:
    """The arguments that name a revision and, once it is here, stop asking.

    ⚠️ Measured on this repository's own models: a commit hash on its own does
    *not* keep the loaders off the network. Loading hayai took 4.4 seconds with
    the revision pinned and the hub reachable, 1.6 with `local_files_only` as
    well — and the same 4.4 on the run after, so it is not a first-time cost.
    Whatever the loaders revalidate, they revalidate every time. This is the
    only argument that stops them.

    `kwargs` narrow what counts as present — a repository is cached enough when
    the files this model actually opens are cached — and reach the check alone,
    since they are not arguments the loaders take.
    """
    return {"revision": revision, "local_files_only": hub_cached(repo, revision, **kwargs)}
