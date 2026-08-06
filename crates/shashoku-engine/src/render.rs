use harfrust::{Direction, Feature, ShapeOptions, ShaperData, Tag, UnicodeBuffer};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use tiny_skia::{FillRule, Mask, Path, PathBuilder, Stroke, Transform};

use crate::stroke::{coverage_at, signed_distance_field};

// ────────────────────────────────────────────────────────────────────────────
// Public types

pub struct TextBitmap {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Distance from top of bitmap (Y=0) to baseline (horizontal) or column
    /// center X (vertical), in pixels. Useful for stacking multiple runs.
    pub baseline: f32,
    /// Where each cluster of the input string landed, for callers that need to
    /// point at individual characters after the fact.
    pub clusters: Vec<ClusterRect>,
}

/// What a render call reports about the bitmap, without the bitmap. Everything
/// here is settled by layout — the paint that follows can only fill the frame
/// these describe — so a caller that only wants the frame gets it for the cost
/// of shaping and outlining, which is a fraction of a percent of painting.
pub struct TextMeasure {
    pub width: u32,
    pub height: u32,
    pub baseline: f32,
    pub clusters: Vec<ClusterRect>,
}

#[derive(Copy, Clone, Debug)]
pub struct Rgba(pub u8, pub u8, pub u8, pub u8);

pub const BLACK: Rgba = Rgba(0, 0, 0, 255);

/// How far into its own pixel the run starts, in bitmap pixels.
///
/// The caller floors the position it is drawing at and hands the remainder
/// here, so the fraction is spent on coverage instead of on a resample the
/// caller does not control — the standard glyph convention, and the reason a
/// half-pixel offset costs contrast rather than sharpness.
///
/// It moves the run inside a bitmap whose size does not follow, so anything
/// pushed past the blank margin is clipped. Sub-pixel values always fit;
/// whole ones are meaningful but are the caller's business to afford.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Phase {
    pub x: f32,
    pub y: f32,
}

/// Where a line short of the longest one sits inside the block.
///
/// Named for the direction the text runs rather than for a side of the bitmap,
/// so one value means the same thing set horizontally and set vertically.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

impl Align {
    /// How much of a short line's slack sits ahead of it.
    fn share(self) -> f32 {
        match self {
            Align::Start => 0.0,
            Align::Center => 0.5,
            Align::End => 1.0,
        }
    }
}

/// No join or cap: the band is grown from the filled shape rather than swept
/// along its outline, so every corner it turns is round by construction — the
/// same reason a Photoshop layer-style stroke offers neither.
#[derive(Copy, Clone, Debug)]
pub struct StrokeSpec {
    pub width: f32,
    pub color: Rgba,
    pub position: StrokePosition,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StrokePosition {
    /// Stroke sits entirely OUTSIDE the glyph outline. PS default.
    Outside,
    /// Stroke sits centered on the outline: half outside, half inside.
    Center,
    /// Stroke sits entirely INSIDE the glyph outline.
    Inside,
}

// ────────────────────────────────────────────────────────────────────────────
// Coverage — shaping only, no rasterization.

/// What the shaper reports for a character it found no glyph for.
const NOTDEF: u32 = 0;

/// Nominal size for a coverage pass. Which glyph a character maps to does not
/// depend on it, and the advances that would are discarded.
const COVERAGE_SIZE_PX: f32 = 16.0;

/// The offsets worth reporting out of those shaping flagged: in text order,
/// without repeats, and never whitespace — layout only needs a space's advance,
/// so a face lacking the glyph is not thereby unable to draw the text.
fn reportable_offsets(text: &str, flagged: &mut Vec<u32>) -> Vec<u32> {
    flagged.sort_unstable();
    flagged.dedup();
    flagged
        .iter()
        .copied()
        .filter(|at| {
            text.get(*at as usize..)
                .and_then(|rest| rest.chars().next())
                .is_some_and(|ch| !ch.is_whitespace())
        })
        .collect()
}

/// Reports whether an outline emitted anything at all, without building it.
struct InkProbe {
    inked: bool,
}

impl OutlinePen for InkProbe {
    fn move_to(&mut self, _x: f32, _y: f32) {
        self.inked = true;
    }
    fn line_to(&mut self, _x: f32, _y: f32) {
        self.inked = true;
    }
    fn quad_to(&mut self, _cx: f32, _cy: f32, _x: f32, _y: f32) {
        self.inked = true;
    }
    fn curve_to(&mut self, _cx0: f32, _cy0: f32, _cx1: f32, _cy1: f32, _x: f32, _y: f32) {
        self.inked = true;
    }
    fn close(&mut self) {}
}

/// Byte offsets of the characters this face cannot draw, keyed the same way as
/// the cluster rects a render reports so callers can line the two up.
///
/// Both halves of this are here because the cmap cannot answer it. A legacy face
/// may carry no Unicode cmap at all — only Big5 and Mac Roman subtables — so a
/// cmap read finds nothing and calls every character missing, including the
/// ASCII the shaper goes on to draw correctly through the Mac Roman table.
///
/// Asking the shaper is necessary but not sufficient, because a Big5 subtable
/// read as though it were Unicode still answers: a CJK codepoint lands inside
/// some mapped range and comes back as a glyph that belongs to another character
/// entirely, usually a blank one. So the question is not whether the shaper
/// found a glyph but whether that glyph draws anything.
pub fn uncovered_clusters(
    font_bytes: &[u8],
    text: &str,
    face_index: u32,
) -> Result<Vec<u32>, String> {
    let hr_font = harfrust::FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("harfrust parse (index {face_index}): {e:?}"))?;
    let sk_font = FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("skrifa parse (index {face_index}): {e:?}"))?;

    let outlines = sk_font.outline_glyphs();
    let size = Size::new(COVERAGE_SIZE_PX);
    let loc = LocationRef::default();

    // Shaped horizontally whichever way the caller will draw: a vertical
    // substitution needs a base glyph to replace, so it cannot turn a covered
    // character into a missing one.
    let mut flagged = Vec::new();
    for (line_offset, glyphs) in shaped_lines(&hr_font, text, COVERAGE_SIZE_PX, 1.0, false) {
        for glyph in glyphs {
            let blank = match outlines.get(GlyphId::new(glyph.gid)) {
                None => true,
                Some(outline) => {
                    let mut probe = InkProbe { inked: false };
                    outline
                        .draw(DrawSettings::unhinted(size, loc), &mut probe)
                        .is_err()
                        || !probe.inked
                }
            };
            if glyph.gid == NOTDEF || blank {
                flagged.push(line_offset + glyph.cluster);
            }
        }
    }
    Ok(reportable_offsets(text, &mut flagged))
}

// ────────────────────────────────────────────────────────────────────────────
// Color parsing

/// Parse "#RRGGBB", "#RRGGBBAA", "RRGGBB", or "RRGGBBAA" into Rgba.
pub fn parse_hex_rgba(hex: &str) -> Result<Rgba, String> {
    let s = hex.trim().trim_start_matches('#');
    let (r, g, b, a) = match s.len() {
        6 => (
            hex_pair(s, 0)?,
            hex_pair(s, 2)?,
            hex_pair(s, 4)?,
            255u8,
        ),
        8 => (
            hex_pair(s, 0)?,
            hex_pair(s, 2)?,
            hex_pair(s, 4)?,
            hex_pair(s, 6)?,
        ),
        _ => {
            return Err(format!(
                "hex color must be #RRGGBB or #RRGGBBAA, got {hex:?}"
            ));
        }
    };
    Ok(Rgba(r, g, b, a))
}

fn hex_pair(s: &str, i: usize) -> Result<u8, String> {
    u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| format!("bad hex pair at {i}: {:?}", &s[i..i + 2]))
}

// ────────────────────────────────────────────────────────────────────────────
// Path building — shared shaping logic. Returns the composed glyph outline as
// a single tiny-skia Path plus the canvas dimensions and baseline.

struct BuiltRun {
    path: Option<Path>,
    width: u32,
    height: u32,
    baseline: f32,
    clusters: Vec<ClusterRect>,
}

/// Where one cluster of the input string landed on the bitmap.
///
/// Keyed by byte offset rather than by glyph index because shaping breaks the
/// one-to-one correspondence between characters and glyphs: a character can
/// become several glyphs, and a ligature turns several characters into one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClusterRect {
    pub cluster: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Unions the boxes of every glyph belonging to the same cluster, keeping the
/// order in which clusters first appear — which is visual order, not string
/// order, once a run is right-to-left.
fn merge_cluster_rects(rects: &[ClusterRect]) -> Vec<ClusterRect> {
    let mut merged: Vec<ClusterRect> = Vec::with_capacity(rects.len());
    for rect in rects {
        match merged.iter_mut().find(|held| held.cluster == rect.cluster) {
            None => merged.push(*rect),
            Some(held) => {
                let min_x = held.x.min(rect.x);
                let min_y = held.y.min(rect.y);
                let max_x = (held.x + held.width).max(rect.x + rect.width);
                let max_y = (held.y + held.height).max(rect.y + rect.height);
                held.x = min_x;
                held.y = min_y;
                held.width = max_x - min_x;
                held.height = max_y - min_y;
            }
        }
    }
    merged
}

/// Shaped glyph, detached from the lifetime of harfrust's GlyphBuffer.
struct ShapedGlyph {
    gid: u32,
    /// Byte offset into the shaped line of the character this glyph came from.
    cluster: u32,
    x_advance: f32,
    y_advance: f32,
    x_offset: f32,
    y_offset: f32,
}

fn shape_line(
    hr_font: &harfrust::FontRef,
    text: &str,
    size_px: f32,
    scale: f32,
    vertical: bool,
) -> Vec<ShapedGlyph> {
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    if vertical {
        buffer.set_direction(Direction::TopToBottom);
    }

    let features: &[Feature] = if vertical {
        &[
            Feature::new(Tag::new(b"vert"), 1, ..),
            Feature::new(Tag::new(b"vrt2"), 1, ..),
        ]
    } else {
        &[]
    };

    let shaper_data = ShaperData::new(hr_font);
    let shaper = shaper_data.shaper(hr_font).build();
    let output = shaper.shape(
        buffer,
        ShapeOptions::new()
            .features(features)
            .point_size(Some(size_px)),
    );

    let infos = output.glyph_infos();
    let positions = output.glyph_positions();
    infos
        .iter()
        .zip(positions.iter())
        .map(|(info, pos)| ShapedGlyph {
            gid: info.glyph_id,
            cluster: info.cluster,
            x_advance: (pos.x_advance as f32) * scale,
            y_advance: (pos.y_advance as f32) * scale,
            x_offset: (pos.x_offset as f32) * scale,
            y_offset: (pos.y_offset as f32) * scale,
        })
        .collect()
}

/// Shapes each \n-separated line, pairing it with its byte offset in `text`.
fn shaped_lines(
    hr_font: &harfrust::FontRef,
    text: &str,
    size_px: f32,
    scale: f32,
    vertical: bool,
) -> Vec<(u32, Vec<ShapedGlyph>)> {
    let mut offset = 0u32;
    let mut out = Vec::new();
    for line in text.split('\n') {
        out.push((offset, shape_line(hr_font, line, size_px, scale, vertical)));
        offset += line.len() as u32 + 1;
    }
    out
}

fn build_horizontal_path(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    phase: Phase,
    align: Align,
) -> Result<BuiltRun, String> {
    let sk_font = FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("skrifa parse (index {face_index}): {e:?}"))?;
    let hr_font = harfrust::FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("harfrust parse (index {face_index}): {e:?}"))?;

    let size = Size::new(size_px);
    let loc = LocationRef::default();
    let metrics = sk_font.metrics(size, loc);
    let upem = metrics.units_per_em as f32;
    let scale = size_px / upem;

    let ascent = metrics.ascent;
    let descent = -metrics.descent;
    let leading = metrics.leading;
    let line_height = (ascent + descent + leading).max(size_px);

    // Empty lines are kept: each one still occupies a full line_height.
    // Each line is shaped on its own, so harfrust's cluster offsets are
    // line-relative and need the line's own offset added back to point into
    // the whole string.
    let lines: Vec<(u32, Vec<ShapedGlyph>)> = shaped_lines(&hr_font, text, size_px, scale, false);

    let widths: Vec<f32> = lines
        .iter()
        .map(|(_, glyphs)| glyphs.iter().map(|g| g.x_advance).sum::<f32>())
        .collect();
    let max_width: f32 = widths.iter().copied().fold(0.0, f32::max);
    let n_lines = lines.len();

    let content_h = line_height * n_lines as f32;
    let w = (max_width.ceil() as u32).max(1) + padding * 2;
    let h = (content_h.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();

    let mut clusters: Vec<ClusterRect> = Vec::new();

    for (line_idx, (line_offset, glyphs)) in lines.iter().enumerate() {
        let baseline_y = padding as f32 + phase.y + ascent + line_idx as f32 * line_height;
        let mut pen_x =
            padding as f32 + phase.x + (max_width - widths[line_idx]) * align.share();
        for g in glyphs {
            let gid = GlyphId::new(g.gid);
            if let Some(glyph) = outlines.get(gid) {
                let mut pen = BaselinePen {
                    builder: &mut builder,
                    pen_x: pen_x + g.x_offset,
                    baseline_y: baseline_y - g.y_offset,
                };
                glyph
                    .draw(DrawSettings::unhinted(size, loc), &mut pen)
                    .map_err(|e| format!("draw gid {gid:?}: {e:?}"))?;
            }
            clusters.push(ClusterRect {
                cluster: line_offset + g.cluster,
                x: pen_x,
                y: baseline_y - ascent,
                width: g.x_advance,
                height: line_height,
            });
            pen_x += g.x_advance;
        }
    }

    Ok(BuiltRun {
        path: builder.finish(),
        width: w,
        height: h,
        baseline: padding as f32 + phase.y + ascent,
        clusters: merge_cluster_rects(&clusters),
    })
}

fn build_vertical_path(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    phase: Phase,
    align: Align,
) -> Result<BuiltRun, String> {
    let sk_font = FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("skrifa parse (index {face_index}): {e:?}"))?;
    let hr_font = harfrust::FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("harfrust parse (index {face_index}): {e:?}"))?;

    let size = Size::new(size_px);
    let loc = LocationRef::default();
    let metrics = sk_font.metrics(size, loc);
    let upem = metrics.units_per_em as f32;
    let scale = size_px / upem;

    // One \n-separated segment per column. CJK vertical convention runs
    // columns right to left.
    let columns: Vec<(u32, Vec<ShapedGlyph>)> = shaped_lines(&hr_font, text, size_px, scale, true);

    let column_width = size_px * 1.2;
    let heights: Vec<f32> = columns
        .iter()
        .map(|(_, glyphs)| glyphs.iter().map(|g| -g.y_advance).sum::<f32>())
        .collect();
    let max_height: f32 = heights.iter().copied().fold(0.0, f32::max);
    let n_cols = columns.len();

    let content_w = column_width * n_cols as f32;
    let w = (content_w.ceil() as u32).max(1) + padding * 2;
    let h = (max_height.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();
    let origin_y = padding as f32 + phase.y;

    let mut clusters: Vec<ClusterRect> = Vec::new();

    for (col_idx, (col_offset, glyphs)) in columns.iter().enumerate() {
        // Column 0 sits at the right edge, later columns walk leftward.
        let col_center_x = (w as f32) - padding as f32 + phase.x - column_width * 0.5
            - (col_idx as f32) * column_width;
        let col_origin_y = origin_y + (max_height - heights[col_idx]) * align.share();
        let mut pen_x = 0.0f32;
        let mut pen_y = 0.0f32;
        for g in glyphs {
            let baseline_x = col_center_x + pen_x + g.x_offset;
            let baseline_y = col_origin_y + pen_y - g.y_offset;

            let gid = GlyphId::new(g.gid);
            if let Some(glyph) = outlines.get(gid) {
                let mut pen = BaselinePen {
                    builder: &mut builder,
                    pen_x: baseline_x,
                    baseline_y,
                };
                glyph
                    .draw(DrawSettings::unhinted(size, loc), &mut pen)
                    .map_err(|e| format!("draw gid {gid:?}: {e:?}"))?;
            }
            clusters.push(ClusterRect {
                cluster: col_offset + g.cluster,
                x: col_center_x - column_width * 0.5,
                y: col_origin_y + pen_y,
                width: column_width,
                height: -g.y_advance,
            });
            pen_x += g.x_advance;
            pen_y -= g.y_advance;
        }
    }

    Ok(BuiltRun {
        path: builder.finish(),
        width: w,
        height: h,
        clusters: merge_cluster_rects(&clusters),
        baseline: (w as f32) - padding as f32 + phase.x - column_width * 0.5,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Paint pipeline — turns a built path + fill + optional stroke into pixels.
//
// The stroke is a band on the distance field of the filled coverage, not an
// offset of the outline. See the stroke module for why.

/// The two boundaries a stroke position asks for, as signed distances from the
/// shape's own edge, negative inward: the outer edge of the stroke, and the
/// edge past which the fill takes over again.
fn band_offsets(position: StrokePosition, width: f32) -> (f32, f32) {
    match position {
        StrokePosition::Outside => (width, 0.0),
        StrokePosition::Center => (width * 0.5, -width * 0.5),
        StrokePosition::Inside => (0.0, -width),
    }
}

fn unit(c: Rgba) -> (f32, f32, f32, f32) {
    (
        c.0 as f32 / 255.0,
        c.1 as f32 / 255.0,
        c.2 as f32 / 255.0,
        c.3 as f32 / 255.0,
    )
}

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

/// Antialiased coverage of the path, the only thing either layer is bounded by.
fn coverage_of(path: &Path, width: u32, height: u32) -> Result<Vec<f32>, String> {
    let mut mask = Mask::new(width, height).ok_or_else(|| "mask alloc failed".to_string())?;
    mask.fill_path(path, FillRule::Winding, true, Transform::identity());
    Ok(mask.data().iter().map(|&v| v as f32 / 255.0).collect())
}

/// Fill over stroke, two flat colours, each bounded by its own coverage.
///
/// Straight alpha rather than premultiplied: the only consumer wraps these
/// bytes in an ImageData, which is defined as non-premultiplied, and reading
/// premultiplied bytes as though they were straight pulls every soft edge
/// towards black — invisible on black text, a grey halo around a white stroke.
/// Composing from coverage rather than multiplying and dividing back out also
/// keeps the colour exact where the division would amplify its rounding.
fn compose(layers: impl Fn(usize) -> (f32, f32), count: usize, fill: Rgba, ink: Rgba) -> Vec<u8> {
    let mut rgba = vec![0u8; count * 4];
    let (fr, fg, fb, fa) = unit(fill);
    let (sr, sg, sb, sa) = unit(ink);

    for i in 0..count {
        let (fill_coverage, ink_coverage) = layers(i);
        let f = fill_coverage * fa;
        let s = ink_coverage * sa;
        let alpha = f + s * (1.0 - f);
        if alpha <= 0.0 {
            continue;
        }
        let mix = |above: f32, below: f32| (above * f + below * s * (1.0 - f)) / alpha;
        rgba[i * 4] = to_u8(mix(fr, sr));
        rgba[i * 4 + 1] = to_u8(mix(fg, sg));
        rgba[i * 4 + 2] = to_u8(mix(fb, sb));
        rgba[i * 4 + 3] = to_u8(alpha);
    }
    rgba
}

/// The extent an axis needs, with the float noise a right angle leaves rounded
/// off first — `cos(PI/2)` is not zero, and a bare ceiling would turn that into
/// a whole extra pixel of blank margin.
fn extent_of(v: f32) -> u32 {
    ((v * 1024.0).round() / 1024.0).ceil().max(1.0) as u32
}

/// The run turned by its object's own angle, on a bitmap grown to hold it.
///
/// Done here, on the outline, rather than by rotating the finished bitmap: a
/// rasterized glyph has its antialiasing already baked in, and resampling that
/// softens every stem with no filter able to bring it back. Coverage computed
/// from an already-turned outline has none of that to undo.
///
/// The size comes from the layout box rather than from the ink, which is what
/// the upright size already was — so a turn cannot change what the frame is
/// measuring, only which rectangle encloses it.
///
/// `baseline` and `clusters` stay in the unrotated layout space they were
/// accumulated in. They answer questions about the text — where a caret goes,
/// which character a click hit — and the caller that turned the object is the
/// one that can turn those answers back.
fn spin(run: BuiltRun, radians: f32) -> BuiltRun {
    if radians == 0.0 {
        return run;
    }
    let (w, h) = (run.width as f32, run.height as f32);
    let cos = radians.cos().abs();
    let sin = radians.sin().abs();
    let width = extent_of(w * cos + h * sin);
    let height = extent_of(w * sin + h * cos);

    // About the run's own middle, then out to the middle of the bitmap that
    // now holds it, so the two centres coincide however far the box grew.
    let turn = Transform::from_translate((width as f32 - w) * 0.5, (height as f32 - h) * 0.5)
        .pre_concat(Transform::from_rotate_at(
            radians.to_degrees(),
            w * 0.5,
            h * 0.5,
        ));

    BuiltRun {
        path: run.path.and_then(|drawn| drawn.transform(turn)),
        width,
        height,
        baseline: run.baseline,
        clusters: run.clusters,
    }
}

/// `weight` moves the fill's own edge, in pixels, positive outward. It is the
/// same distance-field offset a stroke band is read at, which is why thinning
/// costs no more than thickening and needs nothing painted underneath: the
/// glyph is rasterized once and the boundary is asked for somewhere else.
///
/// A stroke's boundaries are relative to the shape's edge, so they move with
/// it — a stroke on a thinned glyph hugs the thinned outline rather than
/// hanging where the untouched outline used to be.
fn paint_run(
    run: BuiltRun,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
    weight: f32,
) -> Result<TextBitmap, String> {
    let count = run.width as usize * run.height as usize;

    let Some(path) = run.path else {
        // No glyphs drew anything — return a transparent bitmap.
        return Ok(TextBitmap {
            width: run.width,
            height: run.height,
            rgba: vec![0u8; count * 4],
            baseline: run.baseline,
            clusters: run.clusters,
        });
    };

    let coverage = coverage_of(&path, run.width, run.height)?;

    let inked = stroke
        .as_ref()
        .is_some_and(|spec| spec.width > 0.0 && spec.color.3 != 0);
    let field = (inked || weight != 0.0)
        .then(|| signed_distance_field(&coverage, run.width as usize, run.height as usize));

    // The rasterizer's own coverage beats anything read back off the distance
    // field, so it stands wherever the boundary asked for is the shape's own.
    let layer = |offset: f32, i: usize| match &field {
        Some(field) if offset != 0.0 => coverage_at(field[i], offset),
        _ => coverage[i],
    };

    let rgba = match stroke {
        Some(spec) if inked => {
            let (outer, inner) = band_offsets(spec.position, spec.width);
            compose(
                |i| (layer(inner + weight, i), layer(outer + weight, i)),
                count,
                fill,
                spec.color,
            )
        }
        _ => compose(|i| (layer(weight, i), 0.0), count, fill, fill),
    };

    Ok(TextBitmap {
        width: run.width,
        height: run.height,
        rgba,
        baseline: run.baseline,
        clusters: run.clusters,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Public horizontal / vertical render — now with fill + stroke support

pub fn render_text(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    rotation: f32,
    phase: Phase,
    align: Align,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
    weight: f32,
) -> Result<TextBitmap, String> {
    let run = build_horizontal_path(font_bytes, text, size_px, padding, face_index, phase, align)?;
    paint_run(spin(run, rotation), fill, stroke, weight)
}

pub fn render_vertical(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    rotation: f32,
    phase: Phase,
    align: Align,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
    weight: f32,
) -> Result<TextBitmap, String> {
    let run = build_vertical_path(font_bytes, text, size_px, padding, face_index, phase, align)?;
    paint_run(spin(run, rotation), fill, stroke, weight)
}

/// The outline was built for the metrics its glyphs settle; nothing here will
/// paint it, so the spin need not carry it either.
fn measure_run(mut run: BuiltRun, rotation: f32) -> TextMeasure {
    run.path = None;
    let run = spin(run, rotation);
    TextMeasure {
        width: run.width,
        height: run.height,
        baseline: run.baseline,
        clusters: run.clusters,
    }
}

pub fn measure_text(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    rotation: f32,
    phase: Phase,
    align: Align,
) -> Result<TextMeasure, String> {
    let run = build_horizontal_path(font_bytes, text, size_px, padding, face_index, phase, align)?;
    Ok(measure_run(run, rotation))
}

pub fn measure_vertical(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    rotation: f32,
    phase: Phase,
    align: Align,
) -> Result<TextMeasure, String> {
    let run = build_vertical_path(font_bytes, text, size_px, padding, face_index, phase, align)?;
    Ok(measure_run(run, rotation))
}

// ────────────────────────────────────────────────────────────────────────────
// Notdef — what there is to draw when there is no face to draw with

/// Thickness of the notdef box's rule, as a fraction of the em. Taken from the
/// .notdef glyphs shipping fonts actually carry: 0.056 em in DejaVu Sans,
/// 0.05 em in Noto Sans CJK.
const NOTDEF_RULE_EM: f32 = 0.055;

/// Distance between rows of boxes, as a multiple of the em — the same figure
/// vertical text already spaces its columns by, so the grid a reader sees is
/// close to what arrives once the font does.
const NOTDEF_LINE_EM: f32 = 1.2;

/// How much of its cell a box fills, the rest being the gap that separates it
/// from its neighbours. Glyphs do not fill their advance either, and the
/// .notdef in Noto Sans CJK is exactly this: 0.8 em wide on a 1 em advance.
const NOTDEF_BOX_EM: f32 = 0.8;

/// One box with an X through it, a square of `side` at `x`, `y`.
///
/// This is the shape OpenType recommends for .notdef — "an empty rectangle, a
/// rectangle with a question mark inside of it, or a rectangle with an X" —
/// and the crossed variant is what the CJK families this tool is aimed at
/// draw. The cross earns its place twice over here: an empty label already
/// shows as a bare rectangle, so an uncrossed box could not be told from one.
fn push_notdef_box(pb: &mut PathBuilder, x: f32, y: f32, side: f32, inset: f32) {
    // Inset by half the rule so the stroke's outer edge lands on the cell's
    // nominal bounds rather than straddling them.
    let (lo_x, lo_y) = (x + inset, y + inset);
    let (hi_x, hi_y) = (x + side - inset, y + side - inset);
    pb.move_to(lo_x, lo_y);
    pb.line_to(hi_x, lo_y);
    pb.line_to(hi_x, hi_y);
    pb.line_to(lo_x, hi_y);
    pb.close();
    pb.move_to(lo_x, lo_y);
    pb.line_to(hi_x, hi_y);
    pb.move_to(hi_x, lo_y);
    pb.line_to(lo_x, hi_y);
}

/// One box per character, laid out on a fixed square grid.
///
/// A box per character rather than one for the whole object, because the
/// object's shape is information the reader still has: how many characters,
/// how many lines, and which way they run. One box would collapse a
/// three-column vertical label and a one-word horizontal one into the same
/// picture, and would leave a frame that jumps in size the moment the font
/// arrives.
///
/// The grid is square and uniform. Every advance would be a guess without a
/// face — a proportional one no more accurate than this and no longer
/// obviously a grid — so this claims to say how much text is here and not how
/// it will set. A square is also what makes the box read as a box.
///
/// Each box fills part of its cell rather than all of it, so neighbours are
/// separated by a gap the way glyphs are by their side bearings. Boxes ruled
/// edge to edge read as one grid, not as several characters.
fn build_notdef_path(
    text: &str,
    size_px: f32,
    padding: u32,
    vertical: bool,
    phase: Phase,
    align: Align,
) -> BuiltRun {
    let em = size_px.max(1.0);
    // Floored at a pixel so the rule survives at small sizes, where a
    // proportional one would thin out to nothing.
    let rule = (em * NOTDEF_RULE_EM).max(1.0);
    let inset = rule / 2.0;
    let lead = em * NOTDEF_LINE_EM;

    // Lines are explicit in the data, not the result of measuring, so this is
    // the one part of layout that survives having no font.
    let lines: Vec<&str> = text.split('\n').collect();
    let longest = lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0)
        .max(1) as f32;
    let n_lines = lines.len().max(1) as f32;

    let (content_w, content_h) = if vertical {
        (lead * n_lines, em * longest)
    } else {
        (em * longest, lead * n_lines)
    };
    let w = (content_w.ceil() as u32).max(1) + padding * 2;
    let h = (content_h.ceil() as u32).max(1) + padding * 2;

    let side = em * NOTDEF_BOX_EM;

    let mut pb = PathBuilder::new();
    let mut clusters: Vec<ClusterRect> = Vec::new();
    let mut offset = 0usize;

    for (line_idx, line) in lines.iter().enumerate() {
        // The cells are uniform on the em, so a line's slack is the characters
        // it is short by — which is why the grid does not shift sideways the
        // moment a real face arrives and the advances stop being guesses.
        let slack = (longest - line.chars().count() as f32) * em * align.share();
        for (cell_idx, ch) in line.chars().enumerate() {
            let (cell_x, cell_y, cell_w, cell_h) = if vertical {
                // Column 0 sits at the right edge, later columns walk leftward.
                (
                    w as f32 - padding as f32 + phase.x - lead * (line_idx as f32 + 1.0),
                    padding as f32 + phase.y + slack + em * cell_idx as f32,
                    lead,
                    em,
                )
            } else {
                (
                    padding as f32 + phase.x + slack + em * cell_idx as f32,
                    padding as f32 + phase.y + lead * line_idx as f32,
                    em,
                    lead,
                )
            };

            // Whitespace holds its cell without drawing one: a space is not a
            // character the machine failed to produce. It still gets a rect,
            // so a caret can rest on it.
            if !ch.is_whitespace() {
                push_notdef_box(
                    &mut pb,
                    cell_x + (cell_w - side) * 0.5,
                    cell_y + (cell_h - side) * 0.5,
                    side,
                    inset,
                );
            }
            // The rect is the whole cell, not the box inside it: it answers
            // where a caret goes and which character a click landed on, and
            // the gap belongs to one character or the other.
            clusters.push(ClusterRect {
                cluster: offset as u32,
                x: cell_x,
                y: cell_y,
                width: cell_w,
                height: cell_h,
            });
            offset += ch.len_utf8();
        }
        offset += 1; // the newline this line was split on
    }

    // Stroked into a filled outline rather than stroked onto the mask: the
    // rest of this file paints from one coverage buffer, and a filled path is
    // what that takes.
    let path = pb.finish().and_then(|drawn| {
        drawn.stroke(
            &Stroke {
                width: rule,
                ..Stroke::default()
            },
            1.0,
        )
    });

    BuiltRun {
        path,
        width: w,
        height: h,
        baseline: if vertical {
            w as f32 - padding as f32 + phase.x - lead * 0.5
        } else {
            padding as f32 + phase.y + em
        },
        clusters,
    }
}

/// The bitmap for a text object whose family this machine has no face for.
///
/// Takes no font because there is none to take — that is the whole case. It
/// still goes through `paint_run`, so the boxes pick up the object's fill and
/// stroke and are antialiased by the same path as its text would have been.
pub fn render_notdef(
    text: &str,
    size_px: f32,
    padding: u32,
    vertical: bool,
    rotation: f32,
    phase: Phase,
    align: Align,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
    weight: f32,
) -> Result<TextBitmap, String> {
    let run = build_notdef_path(text, size_px, padding, vertical, phase, align);
    paint_run(spin(run, rotation), fill, stroke, weight)
}

pub fn measure_notdef(
    text: &str,
    size_px: f32,
    padding: u32,
    vertical: bool,
    rotation: f32,
    phase: Phase,
    align: Align,
) -> TextMeasure {
    measure_run(
        build_notdef_path(text, size_px, padding, vertical, phase, align),
        rotation,
    )
}

// ────────────────────────────────────────────────────────────────────────────
// Pens

struct BaselinePen<'a> {
    builder: &'a mut PathBuilder,
    pen_x: f32,
    baseline_y: f32,
}

impl<'a> BaselinePen<'a> {
    fn map(&self, x: f32, y: f32) -> (f32, f32) {
        (self.pen_x + x, self.baseline_y - y)
    }
}

impl<'a> OutlinePen for BaselinePen<'a> {
    fn move_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.map(x, y);
        self.builder.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.map(x, y);
        self.builder.line_to(x, y);
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let (cx, cy) = self.map(cx, cy);
        let (x, y) = self.map(x, y);
        self.builder.quad_to(cx, cy, x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (cx0, cy0) = self.map(cx0, cy0);
        let (cx1, cy1) = self.map(cx1, cy1);
        let (x, y) = self.map(x, y);
        self.builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
    }
    fn close(&mut self) {
        self.builder.close();
    }
}

#[cfg(test)]
mod spin_tests {
    use super::*;
    use std::f32::consts::{FRAC_PI_2, FRAC_PI_4, PI};

    const SIDE: f32 = 64.0;
    const PAD: u32 = 8;
    const FILL: Rgba = Rgba(0, 0, 0, 255);

    /// Notdef rather than a real face: its geometry is known exactly and it
    /// needs no font file, so what is being measured here is only the turn.
    fn turned(text: &str, radians: f32) -> TextBitmap {
        render_notdef(
            text,
            SIDE,
            PAD,
            false,
            radians,
            Phase::default(),
            Align::default(),
            FILL,
            None,
            0.0,
        ).unwrap()
    }

    fn alpha_at(bmp: &TextBitmap, x: u32, y: u32) -> u8 {
        bmp.rgba[((y * bmp.width + x) * 4 + 3) as usize]
    }

    /// The extent of everything carrying ink, which is what a turn moves.
    fn ink_size(bmp: &TextBitmap) -> (u32, u32) {
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (u32::MAX, 0u32, u32::MAX, 0u32);
        for y in 0..bmp.height {
            for x in 0..bmp.width {
                if alpha_at(bmp, x, y) > 0 {
                    min_x = min_x.min(x);
                    max_x = max_x.max(x);
                    min_y = min_y.min(y);
                    max_y = max_y.max(y);
                }
            }
        }
        (max_x + 1 - min_x, max_y + 1 - min_y)
    }

    #[test]
    fn a_quarter_turn_swaps_the_sides_of_the_bitmap() {
        let upright = turned("ab", 0.0);
        let spun = turned("ab", FRAC_PI_2);
        assert_eq!((spun.width, spun.height), (upright.height, upright.width));
    }

    #[test]
    fn a_half_turn_leaves_the_bitmap_the_size_it_was() {
        let upright = turned("ab", 0.0);
        let spun = turned("ab", PI);
        assert_eq!((spun.width, spun.height), (upright.width, upright.height));
    }

    #[test]
    fn an_angle_off_the_axes_takes_the_rectangle_that_encloses_the_turn() {
        let upright = turned("ab", 0.0);
        let spun = turned("ab", FRAC_PI_4);
        assert!(spun.width > upright.width);
        assert!(spun.height > upright.height);
        // Nothing may pass the diagonal, which is as wide as a turn ever gets.
        let diagonal = ((upright.width * upright.width + upright.height * upright.height) as f32)
            .sqrt()
            .ceil() as u32;
        assert!(spun.width <= diagonal && spun.height <= diagonal);
    }

    #[test]
    fn the_ink_turns_with_the_object() {
        // Two cells side by side are wider than they are tall; standing them
        // up is exactly what a quarter turn does.
        let (upright_w, upright_h) = ink_size(&turned("ab", 0.0));
        let (spun_w, spun_h) = ink_size(&turned("ab", FRAC_PI_2));
        assert!(upright_w > upright_h);
        assert!(spun_h > spun_w);
    }

    #[test]
    fn the_turn_is_rigid() {
        // The ink keeps its own measurements; only which axis they run along
        // has changed. A scale hiding in the transform would show up here.
        let (upright_w, upright_h) = ink_size(&turned("ab", 0.0));
        let (spun_w, spun_h) = ink_size(&turned("ab", FRAC_PI_2));
        assert!(spun_w.abs_diff(upright_h) <= 1, "{spun_w} vs {upright_h}");
        assert!(spun_h.abs_diff(upright_w) <= 1, "{spun_h} vs {upright_w}");
    }

    #[test]
    fn a_turn_does_not_drop_the_ink_off_the_bitmap() {
        let inked = |bmp: &TextBitmap| {
            (0..bmp.width as usize * bmp.height as usize)
                .filter(|i| bmp.rgba[i * 4 + 3] > 0)
                .count()
        };
        // New diagonals antialias differently, so the count moves a little.
        // Clipping a corner against the bitmap edge would not be a little.
        let upright = inked(&turned("ab", 0.0));
        let spun = inked(&turned("ab", FRAC_PI_4));
        assert!(spun * 2 > upright, "ink collapsed: {upright} -> {spun}");
    }

    #[test]
    fn the_clusters_stay_in_the_space_the_text_was_laid_out_in() {
        // They answer where a caret goes and which character a click hit, in
        // the object's own axes. Whoever turned the object turns those back.
        let boxes = |bmp: &TextBitmap| {
            bmp.clusters
                .iter()
                .map(|c| (c.x, c.y, c.width, c.height))
                .collect::<Vec<_>>()
        };
        assert_eq!(boxes(&turned("ab", FRAC_PI_2)), boxes(&turned("ab", 0.0)));
    }
}

#[cfg(test)]
mod notdef_tests {
    use super::*;

    const SIDE: f32 = 64.0;
    const PAD: u32 = 8;
    const FILL: Rgba = Rgba(0, 0, 0, 255);

    /// Row height, as the grid lays it out.
    fn lead() -> u32 {
        (SIDE * NOTDEF_LINE_EM).ceil() as u32
    }

    fn notdef(text: &str, vertical: bool) -> TextBitmap {
        render_notdef(
            text,
            SIDE,
            PAD,
            vertical,
            0.0,
            Phase::default(),
            Align::default(),
            FILL,
            None,
            0.0,
        ).unwrap()
    }

    fn alpha_at(bmp: &TextBitmap, x: u32, y: u32) -> u8 {
        bmp.rgba[((y * bmp.width + x) * 4 + 3) as usize]
    }

    /// Centre of the box drawn for a given column and row of the horizontal
    /// grid — the same point as the cell's centre, since the box is centred.
    fn box_centre(col: f32, row: u32) -> (u32, u32) {
        (
            (PAD as f32 + SIDE * (col + 0.5)) as u32,
            (PAD as f32 + SIDE * NOTDEF_LINE_EM * (row as f32 + 0.5)) as u32,
        )
    }

    /// Half the drawn box, in whole pixels.
    fn half_box() -> u32 {
        (SIDE * NOTDEF_BOX_EM * 0.5) as u32
    }

    /// Leftmost pixel carrying any ink on a given row.
    fn first_inked_x(bmp: &TextBitmap, y: u32) -> Option<u32> {
        (0..bmp.width).find(|&x| alpha_at(bmp, x, y) > 0)
    }

    #[test]
    fn one_character_takes_one_cell() {
        let bmp = notdef("字", false);
        assert_eq!(bmp.width, SIDE as u32 + PAD * 2);
        assert_eq!(bmp.height, lead() + PAD * 2);
    }

    #[test]
    fn the_grid_widens_with_the_longest_line() {
        assert_eq!(notdef("ab", false).width, SIDE as u32 * 2 + PAD * 2);
    }

    #[test]
    fn the_grid_deepens_with_the_line_count() {
        let bmp = notdef("a\nb", false);
        assert_eq!(bmp.height, (SIDE * NOTDEF_LINE_EM * 2.0).ceil() as u32 + PAD * 2);
        // One character wide, since that is the longest line.
        assert_eq!(bmp.width, SIDE as u32 + PAD * 2);
    }

    #[test]
    fn a_vertical_object_stacks_its_characters_into_a_column() {
        let bmp = notdef("ab", true);
        assert_eq!(bmp.height, SIDE as u32 * 2 + PAD * 2);
        assert_eq!(bmp.width, lead() + PAD * 2);
    }

    #[test]
    fn every_character_gets_its_own_box() {
        let bmp = notdef("ab", false);
        for col in 0..2 {
            let (x, y) = box_centre(col as f32, 0);
            assert_eq!(alpha_at(&bmp, x, y), 255, "column {col} has no cross");
        }
    }

    #[test]
    fn a_second_line_draws_below_the_first() {
        let bmp = notdef("a\nb", false);
        for row in 0..2 {
            let (x, y) = box_centre(0.0, row);
            assert_eq!(alpha_at(&bmp, x, y), 255, "row {row} has no cross");
        }
    }

    #[test]
    fn the_boxes_stop_short_of_their_cells_so_they_do_not_run_together() {
        let bmp = notdef("ab", false);
        let (_, cy) = box_centre(0.0, 0);
        // The boundary between the two cells, level with their centres.
        assert_eq!(
            alpha_at(&bmp, PAD + SIDE as u32, cy),
            0,
            "the boxes met at the cell edge"
        );
        // And the gap above the first row, inside the padding-free area.
        let (cx, _) = box_centre(0.0, 0);
        assert_eq!(alpha_at(&bmp, cx, PAD + 1), 0, "the box reached the row edge");
    }

    #[test]
    fn the_frame_is_drawn_around_the_box() {
        let bmp = notdef("字", false);
        let (cx, cy) = box_centre(0.0, 0);
        let half = half_box();
        // Just inside the left rule, level with the centre.
        assert!(alpha_at(&bmp, cx - half + 1, cy) > 0);
        // Just inside the top rule, above the centre.
        assert!(alpha_at(&bmp, cx, cy - half + 1) > 0);
    }

    #[test]
    fn the_quadrants_the_cross_cuts_out_stay_clear() {
        let bmp = notdef("字", false);
        let (cx, cy) = box_centre(0.0, 0);
        let quarter = half_box() / 2;
        // Centres of the four triangles the X leaves behind.
        assert_eq!(alpha_at(&bmp, cx, cy - quarter), 0);
        assert_eq!(alpha_at(&bmp, cx, cy + quarter), 0);
        assert_eq!(alpha_at(&bmp, cx - quarter, cy), 0);
        assert_eq!(alpha_at(&bmp, cx + quarter, cy), 0);
    }

    #[test]
    fn whitespace_holds_its_cell_without_drawing_a_box() {
        let bmp = notdef("a b", false);
        assert_eq!(bmp.width, SIDE as u32 * 3 + PAD * 2);

        let (gap_x, gap_y) = box_centre(1.0, 0);
        assert_eq!(alpha_at(&bmp, gap_x, gap_y), 0, "the space drew a box");
        // The character after it still lands in the third cell, so the space
        // took up room rather than being skipped.
        let (after_x, after_y) = box_centre(2.0, 0);
        assert_eq!(alpha_at(&bmp, after_x, after_y), 255);
    }

    #[test]
    fn every_character_gets_a_rect_a_caret_can_rest_on() {
        let bmp = notdef("永a", false);
        // Byte offsets, not character indices: the CJK character is three
        // bytes, so the second cluster starts at 3.
        assert_eq!(
            bmp.clusters.iter().map(|c| c.cluster).collect::<Vec<_>>(),
            vec![0, 3]
        );
    }

    #[test]
    fn a_newline_is_counted_in_the_offsets_it_separates() {
        let bmp = notdef("a\nb", false);
        assert_eq!(
            bmp.clusters.iter().map(|c| c.cluster).collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    #[test]
    fn the_phase_moves_the_grid_without_resizing_the_bitmap() {
        let (_, row) = box_centre(0.0, 0);
        let square = notdef("字", false);
        let shifted =
            render_notdef(
            "字",
            SIDE,
            PAD,
            false,
            0.0,
            Phase { x: 2.0, y: 0.0 },
            Align::default(),
            FILL,
            None,
            0.0,
        ).unwrap();

        // Where the box starts, which is the cell edge plus its side bearing.
        let bearing = ((SIDE - SIDE * NOTDEF_BOX_EM) * 0.5) as u32;
        assert_eq!(shifted.width, square.width);
        assert_eq!(first_inked_x(&square, row), Some(PAD + bearing));
        assert_eq!(first_inked_x(&shifted, row), Some(PAD + bearing + 2));
    }

    #[test]
    fn the_boxes_wear_the_fill_colour_they_were_given() {
        let red = Rgba(255, 0, 0, 255);
        let bmp = render_notdef(
            "字",
            SIDE,
            PAD,
            false,
            0.0,
            Phase::default(),
            Align::default(),
            red,
            None,
            0.0,
        ).unwrap();
        let (cx, cy) = box_centre(0.0, 0);
        // On the left rule of the box.
        let at = ((cy * bmp.width + cx - half_box() + 1) * 4) as usize;
        assert_eq!(
            [bmp.rgba[at], bmp.rgba[at + 1], bmp.rgba[at + 2]],
            [255, 0, 0]
        );
    }

    #[test]
    fn a_size_below_one_pixel_still_produces_a_bitmap() {
        // Font size is clamped well above this upstream, but a rasterizer that
        // can return a zero-dimension bitmap hands the caller an ImageData that
        // throws on construction.
        let bmp = render_notdef(
            "字",
            0.0,
            0,
            false,
            0.0,
            Phase::default(),
            Align::default(),
            FILL,
            None,
            0.0,
        ).unwrap();
        assert!(bmp.width >= 1 && bmp.height >= 1);
    }
}

#[cfg(test)]
mod align_tests {
    use super::*;

    const SIDE: f32 = 64.0;
    const PAD: u32 = 8;
    const FILL: Rgba = Rgba(0, 0, 0, 255);

    /// Notdef rather than a real face: its cells are square and uniform on the
    /// em, so where a short line ought to land can be stated exactly and
    /// without a font file. That the grid holds without a font is also the
    /// point of it — the same offset has to reach it.
    fn aligned(text: &str, vertical: bool, align: Align) -> TextBitmap {
        render_notdef(
            text,
            SIDE,
            PAD,
            vertical,
            0.0,
            Phase::default(),
            align,
            FILL,
            None,
            0.0,
        )
        .unwrap()
    }

    fn alpha_at(bmp: &TextBitmap, x: u32, y: u32) -> u8 {
        bmp.rgba[((y * bmp.width + x) * 4 + 3) as usize]
    }

    /// Centre of the box drawn `cell` cells along the second row.
    fn second_row_centre(cell: f32) -> (u32, u32) {
        (
            (PAD as f32 + SIDE * (cell + 0.5)) as u32,
            (PAD as f32 + SIDE * NOTDEF_LINE_EM * 1.5) as u32,
        )
    }

    /// Centre of the box drawn `cell` cells down the second column, which sits
    /// to the left of the first since columns run right to left.
    fn second_column_centre(bmp: &TextBitmap, cell: f32) -> (u32, u32) {
        let lead = SIDE * NOTDEF_LINE_EM;
        (
            (bmp.width as f32 - PAD as f32 - lead * 1.5) as u32,
            (PAD as f32 + SIDE * (cell + 0.5)) as u32,
        )
    }

    /// A block two cells wide whose second line fills one, so there is exactly
    /// one cell of slack for the alignment to spend.
    const SHORT_SECOND_LINE: &str = "ab\nc";

    #[test]
    fn a_short_line_starts_where_the_block_does() {
        let bmp = aligned(SHORT_SECOND_LINE, false, Align::Start);
        let (x, y) = second_row_centre(0.0);
        assert_eq!(alpha_at(&bmp, x, y), 255);
    }

    #[test]
    fn a_short_line_takes_half_the_slack_when_centred() {
        let bmp = aligned(SHORT_SECOND_LINE, false, Align::Center);
        let (x, y) = second_row_centre(0.5);
        assert_eq!(alpha_at(&bmp, x, y), 255);
    }

    #[test]
    fn a_short_line_ends_where_the_block_does() {
        let bmp = aligned(SHORT_SECOND_LINE, false, Align::End);
        let (x, y) = second_row_centre(1.0);
        assert_eq!(alpha_at(&bmp, x, y), 255);
    }

    #[test]
    fn a_short_column_starts_where_the_block_does() {
        let bmp = aligned(SHORT_SECOND_LINE, true, Align::Start);
        let (x, y) = second_column_centre(&bmp, 0.0);
        assert_eq!(alpha_at(&bmp, x, y), 255);
    }

    #[test]
    fn a_short_column_ends_where_the_block_does() {
        let bmp = aligned(SHORT_SECOND_LINE, true, Align::End);
        let (x, y) = second_column_centre(&bmp, 1.0);
        assert_eq!(alpha_at(&bmp, x, y), 255);
    }

    /// The block is as wide as its longest line, and that line has no slack to
    /// spend — so there is nothing an alignment could resize.
    #[test]
    fn an_alignment_does_not_change_the_size_of_the_bitmap() {
        let size = |align| {
            let bmp = aligned(SHORT_SECOND_LINE, false, align);
            (bmp.width, bmp.height)
        };
        assert_eq!(size(Align::Start), size(Align::Center));
        assert_eq!(size(Align::Start), size(Align::End));
    }

    /// What a short line is short by is what it measures, not how many
    /// characters it holds — the two agree on the notdef grid, whose cells are
    /// uniform on the em, and part ways the moment real advances arrive.
    #[test]
    fn a_short_line_of_real_glyphs_is_offset_by_what_it_measures() {
        use super::installed_face::{PADDING, SIZE, drawing};
        const TEXT: &str = "WWW\nW";
        let Some((bytes, face)) = drawing(TEXT) else {
            eprintln!("no font on this machine — the real-face align test did not run");
            return;
        };
        let run = |align| {
            build_horizontal_path(&bytes, TEXT, SIZE, PADDING, face, Phase::default(), align)
                .unwrap()
        };
        let put = run(Align::Start);
        let moved = run(Align::End);

        // The second line's only cluster; the first line is three glyphs.
        let slack = moved.clusters[3].x - put.clusters[3].x;
        let block = put.width as f32 - PADDING as f32 * 2.0;
        assert!(slack > 0.0, "the shorter line had no slack to take");
        assert!(
            (slack - (block - put.clusters[3].width)).abs() < 1.0,
            "{slack} is not {block} less the line's own width"
        );
        // The line that set the block's width has none to take.
        assert_eq!(moved.clusters[0].x, put.clusters[0].x);
    }

    /// The rects are what a caret and a click are resolved against, so a line
    /// whose ink moved and whose rects did not would put the caret where there
    /// is no text.
    #[test]
    fn the_cluster_rects_move_with_the_ink() {
        let moved = aligned(SHORT_SECOND_LINE, false, Align::End);
        let put = aligned(SHORT_SECOND_LINE, false, Align::Start);
        // The third cluster is the second line's only character.
        assert_eq!(moved.clusters[2].x - put.clusters[2].x, SIDE);
        assert_eq!(moved.clusters[2].y, put.clusters[2].y);
        // The long line has no slack, so nothing about it moved.
        assert_eq!(moved.clusters[0].x, put.clusters[0].x);
    }
}

#[cfg(test)]
mod stroke_tests {
    use super::*;
    use tiny_skia::Rect;

    const SIZE: u32 = 160;
    const CENTRE: f32 = 80.0;
    const FILL: Rgba = Rgba(0, 0, 0, 255);
    const INK: Rgba = Rgba(255, 0, 0, 255);

    fn disc_run(radius: f32) -> BuiltRun {
        let mut pb = PathBuilder::new();
        pb.push_circle(CENTRE, CENTRE, radius);
        BuiltRun {
            path: pb.finish(),
            width: SIZE,
            height: SIZE,
            baseline: 0.0,
            clusters: Vec::new(),
        }
    }

    fn spec(width: f32, position: StrokePosition) -> StrokeSpec {
        StrokeSpec {
            width,
            color: INK,
            position,
        }
    }

    /// Alpha, and whether the pixel is stroke coloured, at a point `distance`
    /// from the disc's centre along a given angle.
    fn probe(bmp: &TextBitmap, distance: f32, degrees: f32) -> (u8, bool) {
        let radians = degrees.to_radians();
        let x = (CENTRE + distance * radians.cos()) as usize;
        let y = (CENTRE + distance * radians.sin()) as usize;
        let at = (y * bmp.width as usize + x) * 4;
        (bmp.rgba[at + 3], bmp.rgba[at] > 128)
    }

    /// Angles chosen to hit axes, diagonals and directions in between, which
    /// is where a distance transform is least accurate.
    const ANGLES: [f32; 8] = [0.0, 23.0, 45.0, 67.0, 90.0, 141.0, 200.0, 314.0];

    /// Every pixel the edge only partly covers, since a premultiplied byte
    /// read as a straight one shows up exactly there and nowhere else.
    fn soft_edge_colours(bmp: &TextBitmap) -> Vec<[u8; 3]> {
        (0..bmp.width as usize * bmp.height as usize)
            .filter(|i| {
                let a = bmp.rgba[i * 4 + 3];
                a > 0 && a < 255
            })
            .map(|i| [bmp.rgba[i * 4], bmp.rgba[i * 4 + 1], bmp.rgba[i * 4 + 2]])
            .collect()
    }

    #[test]
    fn a_light_fill_keeps_its_colour_where_the_edge_is_soft() {
        let bmp = paint_run(disc_run(30.5), Rgba(255, 255, 255, 255), None, 0.0).unwrap();
        let soft = soft_edge_colours(&bmp);
        assert!(soft.len() > 50, "no soft edge to look at");
        assert!(
            soft.iter().all(|c| c == &[255, 255, 255]),
            "edge pulled towards black: {:?}",
            soft.iter().find(|c| c != &&[255, 255, 255]).unwrap()
        );
    }

    #[test]
    fn a_light_stroke_keeps_its_colour_on_its_outer_edge() {
        let bmp = paint_run(
            disc_run(30.5),
            Rgba(0, 0, 0, 255),
            Some(StrokeSpec {
                width: 6.0,
                color: Rgba(255, 255, 255, 255),
                position: StrokePosition::Outside,
            }),
            0.0,
)
        .unwrap();
        // The fill's own edge is buried under the band, so every soft pixel
        // left belongs to the stroke.
        let soft = soft_edge_colours(&bmp);
        assert!(soft.len() > 50, "no soft edge to look at");
        assert!(
            soft.iter().all(|c| c == &[255, 255, 255]),
            "stroke edge pulled towards black: {:?}",
            soft.iter().find(|c| c != &&[255, 255, 255]).unwrap()
        );
    }

    #[test]
    fn a_pen_wider_than_the_shape_still_fills_solid() {
        // The case the path stroker cannot do: the pen reaches past the far
        // side of the contour, so its inner offset inverts on itself.
        let bmp = paint_run(disc_run(3.0), FILL, Some(spec(8.0, StrokePosition::Outside)), 0.0).unwrap();
        for step in 0..10 {
            for angle in ANGLES {
                let (alpha, _) = probe(&bmp, step as f32, angle);
                assert_eq!(alpha, 255, "hole at {step}px, {angle}deg");
            }
        }
    }

    #[test]
    fn an_outside_stroke_reaches_exactly_the_pen_width() {
        let (radius, pen) = (40.0f32, 6.0f32);
        let bmp = paint_run(
            disc_run(radius),
            FILL,
            Some(spec(pen, StrokePosition::Outside)),
            0.0,
)
        .unwrap();
        for angle in ANGLES {
            let (inner_alpha, inner_is_ink) = probe(&bmp, radius - 2.0, angle);
            assert_eq!(inner_alpha, 255);
            assert!(!inner_is_ink, "fill was overpainted at {angle}deg");

            let (band_alpha, band_is_ink) = probe(&bmp, radius + pen / 2.0, angle);
            assert_eq!(band_alpha, 255, "gap in the band at {angle}deg");
            assert!(band_is_ink, "band is not stroke coloured at {angle}deg");

            let (past_alpha, _) = probe(&bmp, radius + pen + 2.0, angle);
            assert_eq!(past_alpha, 0, "ink past the pen width at {angle}deg");
        }
    }

    #[test]
    fn an_inside_stroke_never_leaves_the_shape() {
        let (radius, pen) = (40.0f32, 6.0f32);
        let bmp = paint_run(
            disc_run(radius),
            FILL,
            Some(spec(pen, StrokePosition::Inside)),
            0.0,
)
        .unwrap();
        for angle in ANGLES {
            let (past_alpha, _) = probe(&bmp, radius + 2.0, angle);
            assert_eq!(past_alpha, 0, "ink outside the shape at {angle}deg");

            let (band_alpha, band_is_ink) = probe(&bmp, radius - pen / 2.0, angle);
            assert_eq!(band_alpha, 255);
            assert!(band_is_ink, "band is not stroke coloured at {angle}deg");

            let (_, core_is_ink) = probe(&bmp, radius - pen - 3.0, angle);
            assert!(!core_is_ink, "stroke ate the fill at {angle}deg");
        }
    }

    #[test]
    fn a_centre_stroke_straddles_the_edge() {
        let (radius, pen) = (40.0f32, 8.0f32);
        let bmp = paint_run(
            disc_run(radius),
            FILL,
            Some(spec(pen, StrokePosition::Center)),
            0.0,
)
        .unwrap();
        for angle in ANGLES {
            let (outer_alpha, outer_is_ink) = probe(&bmp, radius + pen / 4.0, angle);
            assert_eq!(outer_alpha, 255, "gap outside the edge at {angle}deg");
            assert!(outer_is_ink);

            let (_, inner_is_ink) = probe(&bmp, radius - pen / 4.0, angle);
            assert!(inner_is_ink, "band does not reach inside at {angle}deg");

            let (past_alpha, _) = probe(&bmp, radius + pen / 2.0 + 2.0, angle);
            assert_eq!(past_alpha, 0, "ink past half the pen at {angle}deg");
        }
    }

    #[test]
    fn a_counter_narrower_than_the_pen_closes_up() {
        // A hole smaller than the pen fills solid with stroke, the way growing
        // the shape inward from every side would.
        let mut pb = PathBuilder::new();
        pb.push_rect(Rect::from_ltrb(40.0, 40.0, 120.0, 120.0).unwrap());
        // Wound against the outer rectangle, or non-zero winding would treat
        // it as more of the same shape rather than as a hole in it.
        let (lo, hi) = (CENTRE - 4.0, CENTRE + 4.0);
        pb.move_to(lo, lo);
        pb.line_to(lo, hi);
        pb.line_to(hi, hi);
        pb.line_to(hi, lo);
        pb.close();
        let run = BuiltRun {
            path: pb.finish(),
            width: SIZE,
            height: SIZE,
            baseline: 0.0,
            clusters: Vec::new(),
        };

        let bmp = paint_run(run, FILL, Some(spec(10.0, StrokePosition::Outside)), 0.0).unwrap();
        for step in 0..4 {
            for angle in ANGLES {
                let (alpha, is_ink) = probe(&bmp, step as f32, angle);
                assert_eq!(alpha, 255, "hole in the counter at {step}px, {angle}deg");
                assert!(is_ink, "counter is not stroke coloured at {step}px");
            }
        }
    }

    #[test]
    fn a_stroke_of_no_width_is_just_the_fill() {
        let bmp =
            paint_run(disc_run(20.0), FILL, Some(spec(0.0, StrokePosition::Outside)), 0.0).unwrap();
        for angle in ANGLES {
            let (_, is_ink) = probe(&bmp, 10.0, angle);
            assert!(!is_ink);
            let (alpha, _) = probe(&bmp, 24.0, angle);
            assert_eq!(alpha, 0);
        }
    }
}

/// A face this machine happens to have, for the properties that only a real run
/// of glyphs has. There is no font in this repository to draw one with, and
/// vendoring one to test a translation would be a poor trade — so these take
/// whatever is installed and say so when there is nothing, rather than passing
/// on a machine where they never ran.
#[cfg(test)]
mod installed_face {
    use super::*;
    use crate::enumerate;

    pub const SIZE: f32 = 32.0;
    pub const PADDING: u32 = 4;

    pub fn drawing(text: &str) -> Option<(Vec<u8>, u32)> {
        let faces = enumerate::scan(&enumerate::default_dirs(), &[]);
        faces.into_iter().find_map(|face| {
            let bytes = std::fs::read(&face.path).ok()?;
            // Some collections carry faces skrifa declines; only a face that
            // actually draws is any use here.
            let run = build_horizontal_path(
                &bytes,
                text,
                SIZE,
                PADDING,
                face.face_index,
                Phase::default(),
                Align::default(),
            )
            .ok()?;
            run.path.is_some().then_some((bytes, face.face_index))
        })
    }
}

#[cfg(test)]
mod measure_tests {
    use super::installed_face::{PADDING, SIZE, drawing};
    use super::*;

    const TURNS: [f32; 3] = [0.0, 0.6, std::f32::consts::FRAC_PI_2];
    const PHASE: Phase = Phase { x: 0.75, y: 0.25 };

    /// A stroke and a weight on the render side, to pin down that paint options
    /// cannot move the frame — the padding that makes room for them is the
    /// caller's, and it is an input to both calls.
    fn spec() -> Option<StrokeSpec> {
        Some(StrokeSpec {
            width: 3.0,
            color: Rgba(255, 0, 0, 255),
            position: StrokePosition::Outside,
        })
    }

    fn agree(measured: &TextMeasure, rendered: &TextBitmap) {
        assert_eq!(measured.width, rendered.width);
        assert_eq!(measured.height, rendered.height);
        assert_eq!(measured.baseline, rendered.baseline);
        assert_eq!(measured.clusters, rendered.clusters);
    }

    #[test]
    fn a_measured_run_is_the_frame_its_render_comes_back_in() {
        let Some((bytes, face)) = drawing("Hg\ngh") else {
            eprintln!("no font on this machine — measure tests did not run");
            return;
        };
        for turn in TURNS {
            let m = measure_text(&bytes, "Hg\ngh", SIZE, PADDING, face, turn, PHASE, Align::Center)
                .unwrap();
            let r = render_text(
                &bytes,
                "Hg\ngh",
                SIZE,
                PADDING,
                face,
                turn,
                PHASE,
                Align::Center,
                BLACK,
                spec(),
                -1.0,
            )
            .unwrap();
            agree(&m, &r);
        }
    }

    #[test]
    fn a_measured_column_is_the_frame_its_render_comes_back_in() {
        let Some((bytes, face)) = drawing("Hg\ngh") else {
            eprintln!("no font on this machine — measure tests did not run");
            return;
        };
        for turn in TURNS {
            let m =
                measure_vertical(&bytes, "Hg\ngh", SIZE, PADDING, face, turn, PHASE, Align::End)
                    .unwrap();
            let r = render_vertical(
                &bytes,
                "Hg\ngh",
                SIZE,
                PADDING,
                face,
                turn,
                PHASE,
                Align::End,
                BLACK,
                spec(),
                -1.0,
            )
            .unwrap();
            agree(&m, &r);
        }
    }

    #[test]
    fn a_measured_notdef_grid_is_the_frame_its_render_comes_back_in() {
        for vertical in [false, true] {
            for turn in TURNS {
                let m = measure_notdef("ab\nc", SIZE, PADDING, vertical, turn, PHASE, Align::Center);
                let r = render_notdef(
                    "ab\nc",
                    SIZE,
                    PADDING,
                    vertical,
                    turn,
                    PHASE,
                    Align::Center,
                    BLACK,
                    spec(),
                    -1.0,
                )
                .unwrap();
                agree(&m, &r);
            }
        }
    }
}

#[cfg(test)]
mod phase_tests {
    use super::installed_face::{PADDING, SIZE, drawing};
    use super::*;

    const TEXT: &str = "Hg";

    fn any_face() -> Option<(Vec<u8>, u32)> {
        drawing(TEXT)
    }

    fn draw(bytes: &[u8], face_index: u32, phase: Phase) -> TextBitmap {
        render_text(
            bytes,
            TEXT,
            SIZE,
            PADDING,
            face_index,
            0.0,
            phase,
            Align::default(),
            BLACK,
            None,
            0.0,
        )
        .unwrap()
    }

    fn alpha(bmp: &TextBitmap, x: u32, y: u32) -> u8 {
        bmp.rgba[((y * bmp.width + x) * 4 + 3) as usize]
    }

    /// The property everything else rests on: what the phase moves is the
    /// outline, in bitmap pixels, in the direction the caller means. A whole
    /// pixel is the one offset whose answer can be stated exactly.
    #[test]
    fn a_whole_pixel_of_phase_moves_the_ink_exactly_one_cell() {
        let Some((bytes, face)) = any_face() else {
            eprintln!("no font on this machine — phase tests did not run");
            return;
        };
        let at_rest = draw(&bytes, face, Phase::default());
        let moved = draw(&bytes, face, Phase { x: 1.0, y: 2.0 });

        for y in 0..at_rest.height - 2 {
            for x in 0..at_rest.width - 1 {
                assert_eq!(
                    alpha(&at_rest, x, y),
                    alpha(&moved, x + 1, y + 2),
                    "ink did not travel one cell right and two down at ({x}, {y})"
                );
            }
        }
    }

    #[test]
    fn moving_the_run_inside_the_bitmap_does_not_resize_it() {
        let Some((bytes, face)) = any_face() else { return };
        let at_rest = draw(&bytes, face, Phase::default());
        let moved = draw(&bytes, face, Phase { x: 0.5, y: 0.75 });
        assert_eq!((at_rest.width, at_rest.height), (moved.width, moved.height));
    }

    /// Half a pixel is the Raster Tragedy's case: the same light over twice the
    /// area, so the ink softens rather than moving to another cell.
    #[test]
    fn half_a_pixel_of_phase_spreads_the_ink_without_losing_it() {
        let Some((bytes, face)) = any_face() else { return };
        let ink = |bmp: &TextBitmap| -> u64 {
            (0..bmp.width * bmp.height)
                .map(|i| bmp.rgba[(i * 4 + 3) as usize] as u64)
                .sum()
        };
        let soft = |bmp: &TextBitmap| -> usize {
            (0..bmp.width * bmp.height)
                .filter(|i| {
                    let a = bmp.rgba[(i * 4 + 3) as usize];
                    a > 0 && a < 255
                })
                .count()
        };
        let at_rest = draw(&bytes, face, Phase::default());
        let halved = draw(&bytes, face, Phase { x: 0.5, y: 0.5 });

        let (before, after) = (ink(&at_rest) as f64, ink(&halved) as f64);
        assert!(
            (after - before).abs() / before < 0.02,
            "ink was lost or gained: {before} -> {after}"
        );
        assert!(soft(&halved) > soft(&at_rest), "nothing softened");
    }

    /// Both are measured on the bitmap, so both have to follow what it holds.
    #[test]
    fn the_baseline_and_the_clusters_travel_with_the_run() {
        let Some((bytes, face)) = any_face() else { return };
        let at_rest = draw(&bytes, face, Phase::default());
        let moved = draw(&bytes, face, Phase { x: 0.25, y: 0.5 });

        assert!((moved.baseline - at_rest.baseline - 0.5).abs() < 1e-4);
        assert!((moved.clusters[0].x - at_rest.clusters[0].x - 0.25).abs() < 1e-4);
        assert!((moved.clusters[0].y - at_rest.clusters[0].y - 0.5).abs() < 1e-4);
    }

    /// The vertical run measures its baseline across the columns rather than
    /// down them, so the axis its phase lands on is the other one.
    #[test]
    fn a_vertical_run_moves_on_both_axes_too() {
        let Some((bytes, face)) = any_face() else { return };
        let at_rest =
            render_vertical(
                &bytes,
                TEXT,
                SIZE,
                PADDING,
                face,
                0.0,
                Phase::default(),
                Align::default(),
                BLACK,
                None,
                0.0,
            )
            .unwrap();
        let moved = render_vertical(
            &bytes,
            TEXT,
            SIZE,
            PADDING,
            face,
            0.0,
            Phase { x: 0.25, y: 0.5 },
            Align::default(),
            BLACK,
            None,
            0.0,
        )
        .unwrap();

        assert_eq!((at_rest.width, at_rest.height), (moved.width, moved.height));
        assert!((moved.baseline - at_rest.baseline - 0.25).abs() < 1e-4);
        assert!((moved.clusters[0].y - at_rest.clusters[0].y - 0.5).abs() < 1e-4);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(cluster: u32, x: f32, y: f32, width: f32, height: f32) -> ClusterRect {
        ClusterRect {
            cluster,
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn one_glyph_per_cluster_passes_through() {
        let input = [rect(0, 0.0, 0.0, 10.0, 20.0), rect(3, 10.0, 0.0, 10.0, 20.0)];
        assert_eq!(merge_cluster_rects(&input), input.to_vec());
    }

    #[test]
    fn glyphs_sharing_a_cluster_merge_into_their_union() {
        // A base glyph plus a mark drawn above it: one character, two glyphs.
        let input = [
            rect(0, 10.0, 5.0, 10.0, 20.0),
            rect(0, 12.0, 0.0, 6.0, 8.0),
        ];
        assert_eq!(merge_cluster_rects(&input), vec![rect(0, 10.0, 0.0, 10.0, 25.0)]);
    }

    #[test]
    fn a_ligature_keeps_the_cluster_of_its_first_character() {
        // Shaping merges clusters, so both characters report the lower offset.
        let input = [rect(0, 0.0, 0.0, 18.0, 20.0)];
        assert_eq!(merge_cluster_rects(&input), vec![rect(0, 0.0, 0.0, 18.0, 20.0)]);
    }

    #[test]
    fn output_follows_first_appearance_not_cluster_order() {
        // Right-to-left runs place later clusters first.
        let input = [
            rect(6, 0.0, 0.0, 10.0, 20.0),
            rect(3, 10.0, 0.0, 10.0, 20.0),
            rect(6, 5.0, 0.0, 10.0, 20.0),
        ];
        let merged = merge_cluster_rects(&input);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0], rect(6, 0.0, 0.0, 15.0, 20.0));
        assert_eq!(merged[1], rect(3, 10.0, 0.0, 10.0, 20.0));
    }

    #[test]
    fn empty_input_gives_no_rects() {
        assert!(merge_cluster_rects(&[]).is_empty());
    }

    #[test]
    fn nothing_is_uncovered_when_shaping_flagged_nothing() {
        assert!(reportable_offsets("abc", &mut vec![]).is_empty());
    }

    #[test]
    fn a_flagged_cluster_reports_its_byte_offset() {
        assert_eq!(reportable_offsets("abc", &mut vec![1]), vec![1]);
    }

    #[test]
    fn offsets_are_bytes_not_characters() {
        // Each CJK character is three bytes in UTF-8, so the missing 'x' sits
        // at byte 6 even though it is the third character.
        assert_eq!(reportable_offsets("永字x", &mut vec![6]), vec![6]);
    }

    #[test]
    fn whitespace_is_never_reported_as_uncovered() {
        // Layout only needs whitespace advances, so a font lacking a space
        // glyph is not thereby unable to draw the text.
        assert!(reportable_offsets(" \n\t", &mut vec![0, 1, 2]).is_empty());
    }

    #[test]
    fn every_flagged_cluster_is_reported_once_in_text_order() {
        // Several glyphs can share a cluster, and shaping visits runs in its own
        // order, so the same offset can arrive more than once and out of order.
        assert_eq!(
            reportable_offsets("永a字b", &mut vec![7, 3, 7]),
            vec![3, 7]
        );
    }
}
