# Test fonts

`Mplus1-Regular.subset.otf` is M PLUS 1 Regular, cut down to the eight
characters the render tests draw with — `W H g h o 8 鬱 。` — which is why it is
three kilobytes rather than four megabytes.

Ten glyphs come out of that, not eight: `.notdef`, the eight asked for, and the
vertical form of `。`, which the subsetter keeps because the layout tables
reach it. That last one is not spare weight here — this engine sets vertical
text, and that is the glyph it substitutes when it does.

It is here because a test that draws needs to know what it is drawing. Reading
the machine's installed fonts instead made the subject whichever face happened
to be enumerated first, and the answer differed per machine: on one it was a Vai
face, so the test that asks about a CJK glyph had been measuring a `.notdef` box
and passing. In a sandbox there is nothing installed at all, and those tests
returned without running while the suite reported success.

Cut from M PLUS 1 Regular as nixpkgs 26.05 ships it
(`mplus-outline-fonts.githubRelease`, upstream 2022-05-19) with fonttools
4.61.1:

    pyftsubset Mplus1-Regular.otf --text="WHgho8鬱。" \
      --output-file=Mplus1-Regular.subset.otf

Both versions are written down because the command alone does not settle what
comes out: a different release of either would produce different bytes, and the
tests measure bytes.

## Two faces without a vertical form

The column fallback tests need faces that leave characters out of `vert`, which
neither of the fonts they are cut from does — so the layout tables are edited
down to that, on purpose:

- `Mplus1-Regular.novert.subset.otf`: the same M PLUS 1 Regular, cut to `…ー`
  with GSUB dropped. No `vert` and no presentation forms, so a column has
  nothing to fall back to but laying the character on its side.

      pyftsubset Mplus1-Regular.otf --text="…ー" --drop-tables+=GSUB \
        --output-file=Mplus1-Regular.novert.subset.otf

- `NotoSansCJK.forms.subset.otf`: Noto Sans CJK JP from nixpkgs
  `noto-fonts-cjk-sans` 2.004 (`NotoSansCJK-VF.otf.ttc`, face 0), instanced at
  `wght=400`, cut to `…︙「！︕` keeping only `vert`, and with the entries for
  `…` and `！` then deleted from the single substitutions — a `vert` that still
  turns `「` but forgot `…`, in a face that draws `︙`, and that keeps `！`
  upright the way GenYoGothic JP does while drawing a `︕` off to one side.
  That is the shape of the faces this exists for; a face with no `vert` at all
  the shaper already sends to the presentation forms itself. Done with
  fonttools 4.61.1's `varLib.instancer` and `subset` from Python, deleting the
  mappings by hand.

Licensed under the SIL Open Font License 1.1, whose text is beside it. The
license travels with the subset: a derivative of an OFL font stays under the
OFL, and the copyright notice has to go with it.
