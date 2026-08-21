# 1. Own the whole font pipeline instead of Chromium's

Date: 2026-07-26

## Status

Accepted

## Context

Two problems arrived separately and turned out to have one answer.

### The web platform cannot typeset manga

**Vertical CJK layout.** Punctuation has to rotate through the `vert` / `vrt2`
OpenType features, text splits into columns, and columns stack right to left.

**Photoshop stroke semantics.** Three stroke positions: outside draws a stroke
of twice the nominal width beneath the fill, centre fills and then strokes at
the nominal width, and inside strokes at twice the width clipped to the fill.

CSS offers only `-webkit-text-stroke`, which is centre-aligned with no position
control. Two escalations from there were built and abandoned in an earlier
prototype: **SVG filters**, in three variants, all of which showed rasterisation
tiling artifacts under Chromium; and **opentype.js parsing with CanvasKit vector
rendering**, which exhausted V8's 4 GB heap while parsing large CJK fonts.

A survey of all-in-one Rust text stacks — cosmic-text, parley and others — found
none that support CJK vertical writing.

### Chromium will not accept the fonts our users have

Users want to typeset with fonts they have not added to the operating system's
font set.

Every route that hands font bytes to Chromium turns out to be the same route.
`new FontFace(family, bytes)` and `@font-face { src: url(...) }` — whether that
URL is `file://` or a privileged custom protocol — all load the bytes as a web
font, and web fonts pass through the OpenType Sanitiser. OTS validates each
table and rejects what it cannot verify; its cmap validator handles formats 0,
4, 12, 13 and 14, but not format 2, which older CJK fonts use. An earlier
prototype had a large share of a real font library rejected this way and
migrated off `FontFace` because of it.

The one `src` type that bypasses OTS is `local()`, because it asks the platform
for an installed font instead of supplying bytes. That is why installing every
imported font looked like the only option.

### The two problems share an answer

If the application renders text itself, Chromium's font path is never involved —
and the installation requirement disappears along with it. Solving the first
problem dissolves the second.

## Decision

Own the entire pipeline: reading, layout, rasterisation, and text input.

1. **Rendering.** Assemble layout and rasterisation from low-level crates —
   skrifa for outlines and name tables, harfrust for shaping, tiny-skia for
   rasterisation — exposed as a napi-rs native addon required from the preload
   script.

2. **Font access.** The engine opens files by path and memory-maps them.
   `FontSource` carries `{ path, faceIndex }`. The application performs no
   installation, no registration, and no private fontconfig setup.

3. **Imported fonts.** Record the folder paths the user adds and rescan them.
   Font files are never copied into application storage.

4. **Text input.** Typing always happens in a native input control. What the
   engine draws is a projection of that control's text, caret and selection —
   never a place a key is delivered to.

The four are a chain, not a list. (1) makes (2) possible, (2) makes (3)
meaningful, and (4) is what keeps (1) from having to reimplement text input.

## Consequences

### Rendering

The addon runs in the renderer process, which requires
`webPreferences.sandbox = false`. `contextIsolation` remains the primary
boundary for renderer code.

A prebuilt `.node` has to ship for every platform and architecture. That needs
CI runners per platform, and macOS additionally needs signing and notarisation.
This is the largest operational cost of the whole decision.

Layout is deterministic and identical everywhere. The same project opened on
another operating system produces the same line breaks, spacing and punctuation
placement. A DOM-based renderer cannot offer this, because each platform's font
matcher and fallback chain differ.

Rasterisation measures 0.3–0.6 ms per sample in a release build. Debug builds
are roughly fifteen times slower, so performance judgements must never be drawn
from them.

### Font access

OTS imposes no constraint at all. A font the engine can parse is a font the
application can use.

No restart is needed after adding fonts. Chromium snapshots the system font list
at startup on all three platforms, and that snapshot is irrelevant here because
the catalogue is built by scanning directories directly.

Faces inside a `.ttc` collection are addressable by index. `local()` cannot
select a face within a collection, so this route is strictly more capable.

Family identity has a single source — the name tables the engine reads — so a
sample can never silently render in a substituted font because our name and the
platform's name disagreed.

Imported fonts stay invisible to other applications. A user who wants them
elsewhere installs them by hand, outside this application.

Reading by path is also what makes the picker fast. Retrieving bytes through
Chromium's Local Font Access API returned an entire 32.7 MB collection per call
with no cache; twelve cells cost 175 ms that way against 4.3 ms when the bytes
were already held. Memory-mapping costs roughly 0.036 ms per call.

Mappings are created per call and dropped immediately rather than cached. On
Windows a mapped file cannot be deleted or renamed, and a per-call lifetime
keeps that window under a millisecond.

### Imported folders

Copying would not buy portability. Project files identify a font by family name
rather than by path — so that a collaborator whose interface language differs
resolves to the same font — and a collaborator who lacks the font lacks it
whether or not a copy exists on our side.

The failure mode is visible. If a folder is moved or a drive is unmounted, a
whole batch of families disappears from the catalogue at once, which reads as an
event the user can act on. The failure mode of copying is silent: the source
gets updated and the application keeps drawing with a stale duplicate.

The interface tells users to prefer an internal SSD, and explains why — the
engine reads these files directly rather than copying them, so a mechanical disk
slows sample rendering, and unplugging a removable drive takes a batch of fonts
with it mid-session.

No detection of slow or removable storage is attempted. Identifying either
reliably needs three separate mechanisms across Linux, macOS and Windows, and a
false positive — warning about an internal NVMe drive — is worse than staying
quiet.

Removing a folder from the list drops those families from the catalogue. It
deletes nothing from disk.

### Text input

Because samples and labels are engine-drawn bitmaps, there is no DOM text to put
a caret in. There does not have to be: a native input holds the string and the
keyboard, and the bitmap shows what that string currently is.

Caret and selection are projected by index rather than by measuring anything.
The input reports its selection in string offsets, and the engine already
returns a rectangle per cluster — so "the caret is before the eighth character"
is answered by a table lookup, not by adding up advance widths. Nothing about
the input's own font, size or line breaking can move the projected caret,
because none of it is consulted.

The same cluster table answers three separate questions: where to mark missing
characters, which character a click landed on, and where the caret goes. That
is why the projection is a few dozen lines rather than the thousand VS Code
spends on hit testing, which has to derive the same answers back out of the DOM.

The pointer stays on the engine-drawn surface. Clicking and dragging there set
the input's selection directly, so only keys and composition ever reach the
input, and there are never two copies of the text to reconcile — the input owns
the string, and the projection owns nothing.

The platform IME therefore needs no work of ours. A native input is what every
IME on every platform is written against, so Windows TSF, macOS
`NSTextInputClient` and ibus or fcitx5 on Linux are all somebody else's problem.
Placing the candidate window is the one thing left to us, and it is a position
rather than a protocol.

### Nothing is drawn in a face the object did not name

Two separate things go wrong here, and neither is answered by reaching for some
other family.

**A face that lacks a character** draws that character as a box, and the picker
names the characters responsible rather than standing another family in. This
is the opposite of what a reader-facing application does, and it follows from
who uses this one: a typesetter picks a face for how it looks, and a face that
cannot set the line is not a candidate. Coverage is a reason to reject a font,
not a gap to paper over.

**A family this machine has no face for** draws one box per character — the
shape OpenType recommends for a face's own .notdef, a rectangle with an X — on
a square grid. Line breaks are stored rather than measured, so how much text
there is and which way it runs survive having no font, and the reader keeps
that much. The grid is uniform on the em because every advance would otherwise
be a guess: it says how much text is here, not how it will set. The object
itself is untouched, keeps the family name it was given, and typesets the
moment that font is present.

Both cases come out of the same constraint. A text style names exactly one
family and nothing in this pipeline consults a second one, so a sample
assembled from two faces would show a result the application cannot produce.
Substituting a bundled font would be that same lie at a larger scope — a page
that looks typeset in a font the project does not name.

Drawing a box rather than refusing to draw is what keeps "cannot be drawn" from
existing anywhere downstream. An object always has a bitmap, so the canvas and
the export are the same picture by construction, and neither carries a failure
case. The interface marks the substitution on the object's frame and in the
layer tree, alongside locked and hidden — it is a state, not an error.

The picker therefore offers one choice about missing glyphs: whether families
that cannot draw the sample appear in the list at all.

### The thing not to "fix"

Making the sample cells DOM text with a `font-family` would delete the
projection outright and give caret, selection and clipboard for free.

It would also silently reacquire OTS for every imported font. Older CJK families
would vanish from the list or draw incorrectly, with no error anywhere.

Decision (4) is not that same move made safely, and reading it that way is the
mistake this section exists to stop. The input is a native control that never
opens one of our font files and never asks Chromium to — whatever it renders, it
renders in a font the platform already had. The letters anyone reads are the
engine's, drawn from bytes Chromium never sees. What moved into the DOM is the
keyboard, not the typeface.

The projection is the price of decision (2). Anyone proposing to replace it with
DOM text in the user's own font is proposing to require font installation, and
should say so explicitly.
