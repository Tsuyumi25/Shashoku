use harfrust::{Direction, Feature, ShapeOptions, ShaperData, Tag, UnicodeBuffer};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use tiny_skia::{Color, FillRule, Mask, Paint, Path, PathBuilder, Pixmap, Transform};

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

#[derive(Copy, Clone, Debug)]
pub struct Rgba(pub u8, pub u8, pub u8, pub u8);

pub const BLACK: Rgba = Rgba(0, 0, 0, 255);

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

/// Fill and stroke as two flat colours, each bounded by its own offset of the
/// same edge, composited fill over stroke.
fn paint_banded(pixmap: &mut Pixmap, path: &Path, fill: Rgba, spec: StrokeSpec) -> Result<(), String> {
    let (width, height) = (pixmap.width(), pixmap.height());

    let mut mask = Mask::new(width, height).ok_or_else(|| "mask alloc failed".to_string())?;
    mask.fill_path(path, FillRule::Winding, true, Transform::identity());
    let coverage: Vec<f32> = mask.data().iter().map(|&v| v as f32 / 255.0).collect();

    let field = signed_distance_field(&coverage, width as usize, height as usize);
    let (outer, inner) = band_offsets(spec.position, spec.width);

    // The rasterizer's own coverage beats anything read back off the distance
    // field, so it stands wherever the boundary asked for is the shape's own.
    let layer = |offset: f32, i: usize| {
        if offset == 0.0 {
            coverage[i]
        } else {
            coverage_at(field[i], offset)
        }
    };

    let (fr, fg, fb, fa) = unit(fill);
    let (sr, sg, sb, sa) = unit(spec.color);

    let data = pixmap.data_mut();
    for i in 0..(width as usize * height as usize) {
        let s = layer(outer, i) * sa;
        let f = layer(inner, i) * fa;
        let alpha = f + s * (1.0 - f);
        if alpha <= 0.0 {
            continue;
        }
        let a8 = to_u8(alpha);
        // Premultiplied, and never above the alpha it is multiplied by —
        // rounding the two independently can otherwise break that invariant
        // by one and hand tiny-skia a pixel it considers malformed.
        data[i * 4] = to_u8(fr * f + sr * s * (1.0 - f)).min(a8);
        data[i * 4 + 1] = to_u8(fg * f + sg * s * (1.0 - f)).min(a8);
        data[i * 4 + 2] = to_u8(fb * f + sb * s * (1.0 - f)).min(a8);
        data[i * 4 + 3] = a8;
    }
    Ok(())
}

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

    match stroke {
        Some(spec) if spec.width > 0.0 && spec.color.3 != 0 => {
            paint_banded(&mut pixmap, &path, fill, spec)?;
        }
        _ => {
            let mut fill_paint = Paint::default();
            fill_paint.set_color(rgba_to_color(fill));
            fill_paint.anti_alias = true;
            pixmap.fill_path(
                &path,
                &fill_paint,
                FillRule::Winding,
                Transform::identity(),
                None,
            );
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

    #[test]
    fn a_pen_wider_than_the_shape_still_fills_solid() {
        // The case the path stroker cannot do: the pen reaches past the far
        // side of the contour, so its inner offset inverts on itself.
        let bmp = paint_run(disc_run(3.0), FILL, Some(spec(8.0, StrokePosition::Outside))).unwrap();
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

        let bmp = paint_run(run, FILL, Some(spec(10.0, StrokePosition::Outside))).unwrap();
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
        let bmp = paint_run(disc_run(20.0), FILL, Some(spec(0.0, StrokePosition::Outside))).unwrap();
        for angle in ANGLES {
            let (_, is_ink) = probe(&bmp, 10.0, angle);
            assert!(!is_ink);
            let (alpha, _) = probe(&bmp, 24.0, angle);
            assert_eq!(alpha, 0);
        }
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
