"""hub_cached() must refuse to trust a cache directory it never verified.

The fake hub below never touches the network or the real on-disk cache. It
models exactly the two facts `huggingface_hub` 1.27.0 actually exposes: a
tree listing (written only by `snapshot_download`) that names which files a
revision is supposed to have, and a `local_files_only` snapshot pass that
compares that listing against what's on disk. A hub state with no listing but
"files_complete=True" reproduces the lie described in the ticket: a loader
that fetched one file at a time (`hf_hub_download`, or a model's own
`trust_remote_code` grabbing a single `config.json`) leaves the directory
non-empty with nothing to check it against.
"""

from __future__ import annotations

import pytest
from huggingface_hub.errors import CachedRepoTreeNotFoundError

import shashoku_ocr.weights as weights

REPO = "org/some-model"
REVISION = "abc123"


class FakeHub:
    """Stands in for `huggingface_hub.get_cached_repo_tree` and
    `snapshot_download`, both mirroring the real functions' keyword-only
    signatures exactly. That's load-bearing, not decoration: the real
    `get_cached_repo_tree` has no `**kwargs` catch-all, so a caller that
    hands it a "which files count" argument (`allow_patterns`,
    `ignore_patterns`) gets a `TypeError` from Python itself — reproducing
    that signature here means a regression that starts passing those kwargs
    to the tree check fails this fixture the same way it would fail against
    the real library, with no separate assertion needed.
    """

    def __init__(self, *, has_listing: bool, files_complete: bool) -> None:
        self.has_listing = has_listing
        self.files_complete = files_complete
        self.calls: list[str] = []

    def get_cached_repo_tree(
        self,
        repo_id: str,
        *,
        repo_type: str | None = None,
        revision: str | None = None,
        cache_dir: str | None = None,
        local_dir: str | None = None,
    ) -> list[object]:
        self.calls.append("tree")
        if not self.has_listing:
            raise CachedRepoTreeNotFoundError(
                f"no cached tree listing for '{repo_id}' (revision '{revision}')"
            )
        return []

    def snapshot_download(
        self,
        repo_id: str,
        *,
        revision: str | None = None,
        local_files_only: bool | None = None,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
    ) -> str:
        self.calls.append("snapshot")
        if not self.files_complete:
            raise OSError(f"incomplete cache for '{repo_id}' (revision '{revision}')")
        return "/fake/hub/cache/" + repo_id


@pytest.fixture
def fake_hub(monkeypatch: pytest.MonkeyPatch):
    def _install(*, has_listing: bool, files_complete: bool) -> FakeHub:
        hub = FakeHub(has_listing=has_listing, files_complete=files_complete)
        monkeypatch.setattr(
            "huggingface_hub.get_cached_repo_tree", hub.get_cached_repo_tree
        )
        monkeypatch.setattr("huggingface_hub.snapshot_download", hub.snapshot_download)
        return hub

    return _install


def test_no_listing_is_reported_as_not_cached(fake_hub) -> None:
    """The exact lie from the ticket: a directory a single-file loader left
    behind, with no tree listing to check it against.  `snapshot_download`
    would happily report it complete — `files_complete=True` here proves
    that's not what saves this case; only the missing listing does.
    """
    hub = fake_hub(has_listing=False, files_complete=True)

    assert weights.hub_cached(REPO, REVISION) is False
    # Never even reached the snapshot check — nothing to verify against.
    assert hub.calls == ["tree"]


def test_listing_with_missing_files_is_reported_as_not_cached(fake_hub) -> None:
    hub = fake_hub(has_listing=True, files_complete=False)

    assert weights.hub_cached(REPO, REVISION) is False
    assert hub.calls == ["tree", "snapshot"]


def test_listing_with_complete_files_is_reported_as_cached(fake_hub) -> None:
    hub = fake_hub(has_listing=True, files_complete=True)

    assert weights.hub_cached(REPO, REVISION) is True
    assert hub.calls == ["tree", "snapshot"]


def test_tree_listing_is_asked_for_before_the_snapshot_check(fake_hub) -> None:
    """⭐ The order itself, asserted directly rather than only inferred from
    the three cases above. Reversing it is unsafe in exactly the way the
    upstream maintainer described: a concurrent download that publishes the
    listing between the two calls would make `snapshot_download` the one
    that catches the missing files — but only if it runs *after* the listing
    check, never before it.
    """
    hub = fake_hub(has_listing=True, files_complete=True)

    weights.hub_cached(REPO, REVISION)

    assert hub.calls == ["tree", "snapshot"], (
        "hub_cached must ask get_cached_repo_tree before snapshot_download, "
        "never the reverse"
    )


def test_file_selection_kwargs_reach_only_the_snapshot_check(fake_hub) -> None:
    """`allow_patterns` / `ignore_patterns` describe which files count as
    present for *this* model. They are meaningless against a tree listing —
    real `get_cached_repo_tree` has no such parameter and raises `TypeError`
    if handed one, which `FakeHub.get_cached_repo_tree` above reproduces by
    mirroring that exact signature. So this test doubles as the "wrong
    parameter reaches the wrong call" guard: if `hub_cached` ever started
    passing `allow_patterns` into the tree check, this call would raise
    `TypeError` instead of returning `True`.
    """
    hub = fake_hub(has_listing=True, files_complete=True)

    result = weights.hub_cached(REPO, REVISION, allow_patterns=["*.safetensors"])

    assert result is True
    assert hub.calls == ["tree", "snapshot"]
