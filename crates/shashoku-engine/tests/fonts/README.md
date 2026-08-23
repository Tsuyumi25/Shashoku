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

Licensed under the SIL Open Font License 1.1, whose text is beside it. The
license travels with the subset: a derivative of an OFL font stays under the
OFL, and the copyright notice has to go with it.
