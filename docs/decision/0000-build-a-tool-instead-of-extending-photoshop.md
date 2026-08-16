# 0. Build a tool for manga localisation instead of extending Photoshop

Date: 2026-08-16

## Status

Accepted. Recorded retroactively: the decision was taken on 2026-07-17, and this
record was written on 2026-08-16 — which is why it cites ADR-0001 as already
existing.

## Context

### Photoshop is good at this, which is why the question is hard

Every established manga localisation workflow ends in Photoshop. LabelPlus writes
a text file, a script turns it into text layers, and the letterer finishes the page
there. Other implementations of the same idea exist — LabelPlusFX, FX_New — and
they keep that shape.

That is not inertia. Photoshop is genuinely good at the lettering half: live text
layers, three stroke positions, free transform, layer masks, a brush engine, and
years of muscle memory in the people doing the work.

What Photoshop does not have is any idea that it is looking at a manga page. There
is no reading order. There is no pairing between a line of source and the line of
translation that replaces it. Nothing says this page belongs to a chapter, or that
a line has been checked. Those live in the other tool, in a text file, and the two
halves stop agreeing the moment either is touched.

### The work has to be able to finish

The target is a page that can be finished completely: no original text left
anywhere, sound effects included, at a quality that does not announce itself as a
translation. Not every translator works to that standard, and the tool does not
require it — but a tool that cannot reach it has decided the question for its
users.

That requirement is what sets the level. Balloon dialogue can be replaced by a text
box over a white fill. A sound effect drawn into the artwork cannot: the picture
underneath it has to be reconstructed, and what replaces it is often written by
hand rather than set in a face.

Those are two different jobs. Reconstructing the artwork is a retouching model's
work, which is also how it is done in Photoshop. Putting the new lettering there is
not: it needs selection, layers, and a brush — the brush for writing the effect and
for the effects around it, since a sound effect's character is half in the stroke.

**The bar is not "typeset the balloons", it is "finish the page".**

### Two predecessors, not one

```
YetAnotherLabelPlus   2026-07-13 → 07-17
Shashoku-POC          2026-07-16 → 07-28
Shashoku              2026-07-24 →
```

This record is about the first. The "earlier prototype" cited in
[ADR-0001](0001-own-the-font-pipeline.md) is the second, which is this project's
direct ancestor; they are not the same thing.

### An outside tool and an export script: the canvas has no stable point

YetAnotherLabelPlus took the obvious route — a modern LabelPlus paired with a much
faster Photoshop script. It ran for four days.

What stopped it was one question. **Should the canvas show what the text will
finally look like?**

Show it, and the tool has to know how the text wraps, how punctuation rotates in
vertical writing, which side the stroke is drawn on, and which face is substituted
for a missing glyph. Once that is done, Photoshop is no longer needed.

Do not show it, and the tool is a labeller — which is what its predecessors already
were.

There is nothing in between. A preview that is approximately right is worse than no
preview, because people trust it and are then contradicted by Photoshop. The
prototype's own code recorded the seam: the canvas and the project file both
measured type in source pixels, and the conversion to points happened inside the
Photoshop script, against that document's resolution. The canvas was not
typesetting. It was predicting.

**Half a typesetter is worth nothing, and a canvas that shows a translation is
already typesetting.**

### A plugin: the translation has nowhere to live

Writing the tool as a plugin avoids the canvas problem entirely — the canvas is the
host's, and what-you-see-is-what-you-get comes free. It fails on the other side.

Photoshop's document model has layers. A line of translation inside it is a text
layer with no identity: it cannot say which region of source it translates, where
it sits in the reading order, who wrote it, or whether it has been checked. Those
facts have to go into layer names, layer comments, or a parallel metadata file —
**which moves the seam inside Photoshop rather than removing it.**

Both Photoshop routes also assume every user carries a subscription, and the
reconstruction that finishing a page actually needs is its generative retouching,
which is paid for on top of that.

Krita is the strongest version of this route and carries neither of those costs —
open source, on Linux, with real pixel editing, screentone generators, vertical
right-to-left text, and local AI retouching available as a plugin. It fails on the
identity instead. Krita's text is an SVG shape inside a vector layer, and in the
Python API a shape is not a document node: `Node` has `uniqueId()`, `Shape` does
not, and `Shape` offers `toSvg()` with no way to write text back. Separately, a
Python plugin cannot add a canvas tool — the entry points are `Extension` and
`DockWidget`, and `Canvas` exposes no pointer events.

### The automatic translators stop at the same line, from the other side

The automatic translators do have canvases, and several have brushes. Their own
documentation says what those brushes are for: koharu describes them as producing
edits that are "different from the model-generated inpainting result"; another
lists inpainting followed by correcting with a brush.

The brush exists to repair what the model did. That is a repair bench, not a
canvas, and it shows in what is missing: across that family there is no pixel
selection. Their select tools pick layers, blocks or text frames. Nothing lets you
enclose a region of pixels and act on it — which is the first thing redrawing a
sound effect needs.

## Decision

Build a tool that is for manga localisation, and own everything a page needs on the
way through it.

1. **The canvas is authoritative.** What is on it is the work, not a preview of
   work that happens elsewhere. Everything below follows from refusing to predict
   another program's output.

2. **Typesetting is ours.** Text is laid out and rasterised by this project, so
   what is drawn is what is exported. The implementation is
   [ADR-0001](0001-own-the-font-pipeline.md).

3. **Pixels are ours.** Selection, layers, erasing and painting are first class. A
   page that has to leave for its pixel work has not stopped being two halves; it
   has only moved the seam.

4. **Photoshop is not required.** A layered PSD is a format this project can write
   for whoever needs one downstream. It is not a stage in the work, and the whole
   path runs on a machine where Photoshop does not exist.

The four are a chain, not a list. (1) is the reason for (2), (2) takes Photoshop
off the path, and (3) is what keeps it off.

## Consequences

### What it costs

Everything Photoshop already does well has to be built or deliberately declined.
There is no version of this decision in which the lettering half is cheap.

The scope is not "a translation tool with an editor attached" but an image editor
with a text engine, which is a much larger program. The font pipeline alone carries
ADR-0001's operational burden: a prebuilt native addon for every platform and
architecture shipped.

### What it buys

The concepts this work is actually about have somewhere to live. Reading order,
semantic tags, source and translation, line-by-line checking — none of them can be
expressed in a general image editor, and all of them are ordinary here.

Cross-platform support is a consequence rather than a goal. Photoshop has no Linux
build; once it is off the path, the platform question leaves with it.

There is one project file and one place the state lives. Handing that file to
somebody else stays possible, and what happens to it afterwards is theirs.

### What it does not claim

This is not a Photoshop replacement, and does not aim to become one. What is taken
from Photoshop is the feel of the lettering step. The rest is out of scope and
stays out of scope — anyone who prefers to finish in Photoshop still can, which is
what the PSD export is for.
