"""Cutting a flat reading back into the lines the artwork set it in.

Two independent sources, neither answering for the other: the characters come
from whichever recognizer read best, and the boundaries come from the column
cutter, which measured them. Nothing here reads pixels — it is arithmetic over
what two models already said.
"""

from __future__ import annotations

from typing import Any, Iterable

# How much of a column has to fall inside a region before it counts as one of
# that region's lines.
#
# ⚠️ Descriptive rather than measured. It works today; if a page's line breaks
# come out visibly wrong, this and the region overlap next door are the first
# two numbers to look at — before anything in the transplant.
COLUMN_SHARE = 0.5

# Below this the direction head has not committed, so its answer does not get to
# order the columns. It refuses to commit on a crop holding a single character,
# which is exactly where the box's own shape is a better witness anyway.
DIRECTION_MARGIN = 1.0


def direction_of(region: dict[str, Any], measured: dict[str, Any] | None) -> bool:
    """Which axis this region's lines stack on, and who gets to say.

    The appraiser when it committed, the box's own proportions when it did not.
    A tall box is the older witness and a worse one — a horizontal block set
    over four lines is taller than it is wide — but it is a witness, where a
    head that reports itself undecided is not.
    """
    if measured is not None and float(measured.get("margin", 0.0)) >= DIRECTION_MARGIN:
        return bool(measured["vertical"])
    return float(region["height"]) > float(region["width"])


def columns_of(
    region: dict[str, Any],
    columns: Iterable[dict[str, Any]],
    vertical: bool,
) -> list[dict[str, Any]]:
    """This region's columns, in the order they are read.

    Right to left when the lines stack sideways, which is a fact about Japanese
    set vertically rather than about this model — the day a second writing
    direction arrives it becomes a property of the document.
    """
    mine = [c for c in columns if _share_inside(c, region) >= COLUMN_SHARE]
    if vertical:
        mine.sort(key=lambda c: -(float(c["x"]) + float(c["width"]) / 2))
    else:
        mine.sort(key=lambda c: float(c["y"]) + float(c["height"]) / 2)
    return mine


def cut(
    places: list[dict[str, Any]],
    region: dict[str, Any],
    columns: list[dict[str, Any]],
    vertical: bool,
) -> list[str] | None:
    """The reading's pieces grouped into lines, or None for "cannot say".

    Each piece joins the nearest column along the axis the lines stack on, and
    ⭐ **only ever forwards**: lines are read in order, so the line a character
    belongs to cannot go back. Without that rule one wandering character cuts
    its sentence twice — once leaving its line and once returning to it.

    None rather than a guess in two cases. Nothing to work with is one. The
    other is degeneracy: two or more columns were found and every piece landed
    in the first, which can only mean an assumption behind the input was
    violated. ⚠️ It does **not** claim to know which one — the direction being
    read backwards looks the same as one column cut into two blocks, and the
    same as a reader's own positions being wrong. Answering "this reading has no
    line breaks" is an ordinary state the rest of the system already handles
    everywhere; claiming a diagnosis and retrying on it would need a diagnosis
    nobody has.
    """
    if not places or len(columns) < 2:
        return None

    axis = [_centre(c, vertical) for c in columns]
    span = float(region["width"] if vertical else region["height"])
    origin = float(region["x"] if vertical else region["y"])

    groups: list[list[str]] = [[] for _ in columns]
    reached = 0
    for place in places:
        at = origin + float(place["x" if vertical else "y"]) * span
        nearest = reached
        for index in range(reached, len(axis)):
            if abs(axis[index] - at) < abs(axis[nearest] - at):
                nearest = index
        reached = nearest
        groups[nearest].append(str(place["text"]))

    if not any(groups[1:]):
        return None
    # A column nobody wrote into is dropped rather than kept as an empty line:
    # the columns were measured off ink, and a reading that skipped one is a
    # reading that disagrees about how many lines there are.
    return ["".join(group) for group in groups if group]


def _centre(box: dict[str, Any], vertical: bool) -> float:
    if vertical:
        return float(box["x"]) + float(box["width"]) / 2
    return float(box["y"]) + float(box["height"]) / 2


def _share_inside(box: dict[str, Any], region: dict[str, Any]) -> float:
    """How much of `box` lies within `region`, as a share of `box`."""
    wide = max(
        0.0,
        min(float(box["x"]) + float(box["width"]), float(region["x"]) + float(region["width"]))
        - max(float(box["x"]), float(region["x"])),
    )
    tall = max(
        0.0,
        min(float(box["y"]) + float(box["height"]), float(region["y"]) + float(region["height"]))
        - max(float(box["y"]), float(region["y"])),
    )
    area = float(box["width"]) * float(box["height"])
    return (wide * tall) / area if area > 0 else 0.0
