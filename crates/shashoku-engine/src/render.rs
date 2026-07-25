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
// Coverage check — cheap cmap lookup, no shaping / rasterization.
// Returns false as soon as any char in `text` maps to .notdef (gid 0).

pub fn font_covers(font_bytes: &[u8], text: &str, face_index: u32) -> Result<bool, String> {
    let font = FontRef::from_index(font_bytes, face_index)
        .map_err(|e| format!("font parse (index {face_index}): {e:?}"))?;
    let charmap = font.charmap();
    for ch in text.chars() {
        // Whitespace needs no real glyph — layout only uses its advance.
        if ch.is_whitespace() {
            continue;
        }
        if charmap.map(ch).is_none() {
            return Ok(false);
        }
    }
    Ok(true)
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
}

/// Shaped glyph, detached from the lifetime of harfrust's GlyphBuffer.
struct ShapedGlyph {
    gid: u32,
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
            x_advance: (pos.x_advance as f32) * scale,
            y_advance: (pos.y_advance as f32) * scale,
            x_offset: (pos.x_offset as f32) * scale,
            y_offset: (pos.y_offset as f32) * scale,
        })
        .collect()
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
    let lines: Vec<Vec<ShapedGlyph>> = text
        .split('\n')
        .map(|line| shape_line(&hr_font, line, size_px, scale, false))
        .collect();

    let max_width: f32 = lines
        .iter()
        .map(|glyphs| glyphs.iter().map(|g| g.x_advance).sum::<f32>())
        .fold(0.0, f32::max);
    let n_lines = lines.len();

    let content_h = line_height * n_lines as f32;
    let w = (max_width.ceil() as u32).max(1) + padding * 2;
    let h = (content_h.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();

    for (line_idx, glyphs) in lines.iter().enumerate() {
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
            pen_x += g.x_advance;
        }
    }

    Ok(BuiltRun {
        path: builder.finish(),
        width: w,
        height: h,
        baseline: padding as f32 + ascent,
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
    let columns: Vec<Vec<ShapedGlyph>> = text
        .split('\n')
        .map(|line| shape_line(&hr_font, line, size_px, scale, true))
        .collect();

    let column_width = size_px * 1.2;
    let max_height: f32 = columns
        .iter()
        .map(|glyphs| glyphs.iter().map(|g| -g.y_advance).sum::<f32>())
        .fold(0.0, f32::max);
    let n_cols = columns.len();

    let content_w = column_width * n_cols as f32;
    let w = (content_w.ceil() as u32).max(1) + padding * 2;
    let h = (max_height.ceil() as u32).max(1) + padding * 2;

    let outlines = sk_font.outline_glyphs();
    let mut builder = PathBuilder::new();
    let origin_y = padding as f32;

    for (col_idx, glyphs) in columns.iter().enumerate() {
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
            pen_x += g.x_advance;
            pen_y -= g.y_advance;
        }
    }

    Ok(BuiltRun {
        path: builder.finish(),
        width: w,
        height: h,
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
