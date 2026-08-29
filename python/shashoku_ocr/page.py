"""Reading one page, end to end.

⭐ The whole trip is one call rather than one per model, and the reason is
memory. Only this loop knows which station comes next, so only this loop can
load one set of weights, use it and drop it before the next arrives. A caller
pressing four buttons cannot do that, and six sets of weights resident at once
is what stops a machine that has other things to do from opening a page.

⚠️ It answers what is written on the artwork and then stops. Which reading wins,
whether an object should be created, where it stands — those are questions about
a document, and the document is on the other side of the line.
"""

from __future__ import annotations

from typing import Any, Callable

from .lines import columns_of, cut, direction_of

# Which detector names mean "there is writing here". `bubble` and `panel` are
# containers — nothing is written on the container itself.
WRITING = frozenset({"text_bubble", "text_free", "text", "onomatopoeia"})

# The one label a recognizer can be spared: drawn over the artwork by hand, and
# three of the four answer rubbish on it.
DRAWN = "onomatopoeia"

# ⭐ A capability rather than a preference. Measured over forty-six hand-cut
# effects, the readers absent from here answer nothing worth listing, and a line
# nobody will pick is one more candidate to rule out by hand on every object
# nearby. Whether the drawn effects are offered at all is the caller's to say;
# which reader is any good at them is not.
READS_DRAWN = frozenset({"hayai"})

# ⭐ Every reader is asked, every time. That is what makes "three of them agree"
# a number rather than an artefact of which buttons someone happened to press.
# PP-OCR leads because it is also the column cutter, and holding it once is
# cheaper than loading those weights twice.
READERS = ("ppocr", "mangaocr", "baberu", "hayai")

# Every stop, in order, so a caller can say how far along the trip is.
STATIONS = ("detect-bubble", "detect-layout", "typography", *(f"read-{m}" for m in READERS))

# How much two boxes have to share before they are one region that both
# detectors found. ⚠️ Descriptive, like `COLUMN_SHARE` next door — see
# `lines.py`.
SAME_REGION = 0.5


def read_page(
    registry: Any,
    image_path: str,
    onomatopoeia: bool,
    say: Callable[[str], None],
) -> dict[str, Any]:
    regions = _regions(registry, image_path, say)
    if not onomatopoeia:
        regions = [r for r in regions if r["label"] != DRAWN]
    if not regions:
        return {"regions": [], "readings": []}

    _measure(registry, image_path, regions, say)

    readings: list[dict[str, Any]] = []
    for model in READERS:
        say(f"read-{model}")
        offered = [
            (at, region)
            for at, region in enumerate(regions)
            if region["label"] != DRAWN or model in READS_DRAWN
        ]
        with registry.held(model) as reader:
            if model == "ppocr":
                # The cutter and one of the readers are the same weights, so
                # the columns are found while they are already in memory. Every
                # region gets them, including the drawn ones this reader is not
                # offered — the readers that follow cut their own flat strings
                # with them.
                _cut_columns(reader, image_path, regions)
                said = _read_columns(reader, image_path, offered)
            else:
                said = _read_regions(reader, image_path, offered)
        readings.extend({"model": model, **one} for one in said)

    return {"regions": [_answered(r) for r in regions], "readings": readings}


def _regions(registry: Any, image_path: str, say: Callable[[str], None]) -> list[dict[str, Any]]:
    """Where there is writing, from both detectors, each region counted once.

    Two rows saying the same sentence is noise rather than a second opinion — a
    second opinion is a second *reader*. ⚠️ The surer box wins across scores two
    different networks produced, which are only roughly the same quantity; safe
    enough, because either box would be read and the choice is between two views
    of the same writing.
    """
    found: list[dict[str, Any]] = []
    for detector in ("bubble", "layout"):
        say(f"detect-{detector}")
        with registry.held(detector) as model:
            found.extend(model.detect(image_path, None))

    kept: list[dict[str, Any]] = []
    for box in sorted((b for b in found if b["label"] in WRITING), key=lambda b: -b["score"]):
        if not any(_overlap(k, box) >= SAME_REGION for k in kept):
            kept.append(box)
    return kept


def _measure(
    registry: Any,
    image_path: str,
    regions: list[dict[str, Any]],
    say: Callable[[str], None],
) -> None:
    """How each region is set, written onto the regions in place."""
    say("typography")
    with registry.held("fontdet") as appraiser:
        measured = appraiser.read(image_path, [_box(r) for r in regions])
    for region, one in zip(regions, measured):
        region["vertical"] = direction_of(region, one)
        region["directionMargin"] = one["margin"]
        region["fontSizePx"] = one["fontSizePx"]
        region["leadingPercent"] = one["leadingPercent"]
        region["angleDeg"] = one["angleDeg"]
        region["color"] = one["color"]


def _cut_columns(cutter: Any, image_path: str, regions: list[dict[str, Any]]) -> None:
    """Where the lines are, over the whole page, shared out to the regions.

    ⭐ Over the page rather than over each region: a column is a slice of a
    region, so handing it a region would be asking it to find again what it was
    just given.
    """
    columns = cutter.detect(image_path, None)
    for region in regions:
        region["columns"] = [_box(c) for c in columns_of(region, columns, region["vertical"])]


def _read_regions(
    reader: Any,
    image_path: str,
    offered: list[tuple[int, dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not offered:
        return []
    said = reader.read(image_path, [_box(region) for _, region in offered])
    out = []
    for (at, region), one in zip(offered, said):
        if not one.get("text"):
            continue
        broken = cut(one.get("places") or [], region, region["columns"], region["vertical"])
        out.append(
            {
                "region": at,
                "text": one["text"],
                "confidence": one["confidence"],
                "lines": broken or [],
            }
        )
    return out


def _read_columns(
    reader: Any,
    image_path: str,
    offered: list[tuple[int, dict[str, Any]]],
) -> list[dict[str, Any]]:
    """The odd reader out, which reads one column at a time.

    ⭐ It needs no cutting: reading a column at a time *is* knowing where the
    lines are. ⚠️ A column that fell inside no region is never read at all —
    over a measured page those were tone and rule lines taken for characters,
    and a reading that reaches the pool costs somebody a decision.
    """
    wanted = [(at, column) for at, region in offered for column in region["columns"]]
    if not wanted:
        return []
    said = reader.read(image_path, [column for _, column in wanted])

    pieces: dict[int, list[dict[str, Any]]] = {}
    for (at, _), one in zip(wanted, said):
        if one.get("text"):
            pieces.setdefault(at, []).append(one)

    return [
        {
            "region": at,
            "text": "".join(p["text"] for p in group),
            # The worst column rather than the average: one unreadable column
            # spoils the sentence it is part of.
            "confidence": min(p["confidence"] for p in group),
            "lines": [p["text"] for p in group] if len(group) > 1 else [],
        }
        for at, group in pieces.items()
    ]


def _box(b: dict[str, Any]) -> dict[str, Any]:
    return {"x": b["x"], "y": b["y"], "width": b["width"], "height": b["height"]}


# What crosses the line, and nothing else. The detector's score, the angle and
# the colours are all measured — the score decides which of two boxes over one
# balloon is kept, and the appraiser answers the other two in the same forward
# pass — but nothing on the far side reads them. ⚠️ A field serialized and never
# read is worse than an absent one: it reads as an answer somebody has, and the
# next person to want it reaches for a guess instead.
ANSWERED = ("label", "x", "y", "width", "height", "vertical", "fontSizePx", "leadingPercent")


def _answered(region: dict[str, Any]) -> dict[str, Any]:
    return {**{k: region[k] for k in ANSWERED}, "columns": region["columns"]}


def _overlap(a: dict[str, Any], b: dict[str, Any]) -> float:
    wide = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    tall = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    both = wide * tall
    either = a["width"] * a["height"] + b["width"] * b["height"] - both
    return both / either if either > 0 else 0.0
