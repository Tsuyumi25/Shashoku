use harfrust::{Direction, Feature, ShapeOptions, ShaperData, Tag, UnicodeBuffer};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Mask, Paint, Path, PathBuilder, Pixmap, Stroke, Transform,
};

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

#[derive(Copy, Clone, Debug)]
pub struct Rgba(pub u8, pub u8, pub u8, pub u8);

pub const BLACK: Rgba = Rgba(0, 0, 0, 255);

#[derive(Copy, Clone, Debug)]
pub struct StrokeSpec {
    pub width: f32,
    pub color: Rgba,
    pub position: StrokePosition,
    pub join: StrokeJoin,
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

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StrokeJoin {
    /// Round corners — safest, no spikes on complex outlines.
    Round,
    /// Sharp mitered corners — PS default; can spike on acute angles.
    Miter,
    /// Chamfered (beveled) corners.
    Bevel,
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

    let max_width: f32 = lines
        .iter()
        .map(|(_, glyphs)| glyphs.iter().map(|g| g.x_advance).sum::<f32>())
        .fold(0.0, f32::max);
    let n_lines = lines.len();

    let content_h = line_height * n_lines as f32;
    let w = (max_width.ceil() as u32).max(1) + padding * 2;
    let h = (content_h.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();

    let mut clusters: Vec<ClusterRect> = Vec::new();

    for (line_idx, (line_offset, glyphs)) in lines.iter().enumerate() {
        let baseline_y = padding as f32 + ascent + line_idx as f32 * line_height;
        let mut pen_x = padding as f32;
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
        baseline: padding as f32 + ascent,
        clusters: merge_cluster_rects(&clusters),
    })
}

fn build_vertical_path(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
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
    let max_height: f32 = columns
        .iter()
        .map(|(_, glyphs)| glyphs.iter().map(|g| -g.y_advance).sum::<f32>())
        .fold(0.0, f32::max);
    let n_cols = columns.len();

    let content_w = column_width * n_cols as f32;
    let w = (content_w.ceil() as u32).max(1) + padding * 2;
    let h = (max_height.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();
    let origin_y = padding as f32;

    let mut clusters: Vec<ClusterRect> = Vec::new();

    for (col_idx, (col_offset, glyphs)) in columns.iter().enumerate() {
        // Column 0 sits at the right edge, later columns walk leftward.
        let col_center_x = (w as f32) - padding as f32 - column_width * 0.5
            - (col_idx as f32) * column_width;
        let mut pen_x = 0.0f32;
        let mut pen_y = 0.0f32;
        for g in glyphs {
            let baseline_x = col_center_x + pen_x + g.x_offset;
            let baseline_y = origin_y + pen_y - g.y_offset;

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
                y: origin_y + pen_y,
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
        baseline: (w as f32) - padding as f32 - column_width * 0.5,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Paint pipeline — turns a built path + fill + optional stroke into pixels.
//
// PS-style stroke has three positions, each with a different draw order:
//
//   Outside  → stroke(width = 2W) THEN fill.  Fill covers inner half of the
//              2W band, leaving W outside the edge visible.
//   Center   → fill THEN stroke(width = W).   Stroke sits centered on the
//              edge, half outside + half inside; fill under is overwritten.
//   Inside   → fill THEN stroke(width = 2W, clipped to fill mask).
//              Only the inner half of the 2W band survives the clip.
//
// Reference: mayocream/koharu uses the Outside pattern (2W stroke + fill on
// top) — this is the standard technique when the raster library lacks
// boolean path ops (tiny-skia doesn't have Skia's Path::op).

fn paint_run(run: BuiltRun, fill: Rgba, stroke: Option<StrokeSpec>) -> Result<TextBitmap, String> {
    let mut pixmap =
        Pixmap::new(run.width, run.height).ok_or_else(|| "pixmap alloc failed".to_string())?;

    let path = match run.path {
        Some(p) => p,
        None => {
            // No glyphs drew anything — return a transparent bitmap.
            return Ok(TextBitmap {
                width: run.width,
                height: run.height,
                rgba: pixmap.data().to_vec(),
                baseline: run.baseline,
                clusters: run.clusters,
            });
        }
    };

    let mut fill_paint = Paint::default();
    fill_paint.set_color(rgba_to_color(fill));
    fill_paint.anti_alias = true;

    match stroke {
        None => {
            pixmap.fill_path(
                &path,
                &fill_paint,
                FillRule::Winding,
                Transform::identity(),
                None,
            );
        }
        Some(spec) if spec.width <= 0.0 || spec.color.3 == 0 => {
            pixmap.fill_path(
                &path,
                &fill_paint,
                FillRule::Winding,
                Transform::identity(),
                None,
            );
        }
        Some(spec) => {
            let mut stroke_paint = Paint::default();
            stroke_paint.set_color(rgba_to_color(spec.color));
            stroke_paint.anti_alias = true;

            let join = match spec.join {
                StrokeJoin::Round => LineJoin::Round,
                StrokeJoin::Miter => LineJoin::Miter,
                StrokeJoin::Bevel => LineJoin::Bevel,
            };

            match spec.position {
                StrokePosition::Outside => {
                    let stroke_style = Stroke {
                        width: spec.width * 2.0,
                        line_cap: LineCap::Round,
                        line_join: join,
                        miter_limit: 4.0,
                        dash: None,
                    };
                    pixmap.stroke_path(
                        &path,
                        &stroke_paint,
                        &stroke_style,
                        Transform::identity(),
                        None,
                    );
                    pixmap.fill_path(
                        &path,
                        &fill_paint,
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                }
                StrokePosition::Center => {
                    pixmap.fill_path(
                        &path,
                        &fill_paint,
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                    let stroke_style = Stroke {
                        width: spec.width,
                        line_cap: LineCap::Round,
                        line_join: join,
                        miter_limit: 4.0,
                        dash: None,
                    };
                    pixmap.stroke_path(
                        &path,
                        &stroke_paint,
                        &stroke_style,
                        Transform::identity(),
                        None,
                    );
                }
                StrokePosition::Inside => {
                    pixmap.fill_path(
                        &path,
                        &fill_paint,
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                    // Clip mask = interior of the glyph. Stroke will only be
                    // visible where the mask is set → inner half of 2W band.
                    let mut mask = Mask::new(run.width, run.height)
                        .ok_or_else(|| "mask alloc failed".to_string())?;
                    mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
                    let stroke_style = Stroke {
                        width: spec.width * 2.0,
                        line_cap: LineCap::Round,
                        line_join: join,
                        miter_limit: 4.0,
                        dash: None,
                    };
                    pixmap.stroke_path(
                        &path,
                        &stroke_paint,
                        &stroke_style,
                        Transform::identity(),
                        Some(&mask),
                    );
                }
            }
        }
    }

    Ok(TextBitmap {
        width: run.width,
        height: run.height,
        rgba: pixmap.data().to_vec(),
        baseline: run.baseline,
        clusters: run.clusters,
    })
}

fn rgba_to_color(c: Rgba) -> Color {
    Color::from_rgba8(c.0, c.1, c.2, c.3)
}

// ────────────────────────────────────────────────────────────────────────────
// Public horizontal / vertical render — now with fill + stroke support

pub fn render_text(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
) -> Result<TextBitmap, String> {
    let run = build_horizontal_path(font_bytes, text, size_px, padding, face_index)?;
    paint_run(run, fill, stroke)
}

pub fn render_vertical(
    font_bytes: &[u8],
    text: &str,
    size_px: f32,
    padding: u32,
    face_index: u32,
    fill: Rgba,
    stroke: Option<StrokeSpec>,
) -> Result<TextBitmap, String> {
    let run = build_vertical_path(font_bytes, text, size_px, padding, face_index)?;
    paint_run(run, fill, stroke)
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
