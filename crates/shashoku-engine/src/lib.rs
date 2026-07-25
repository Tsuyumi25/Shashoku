use std::fs::File;

use memmap2::Mmap;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use skrifa::{FontRef, MetadataProvider, string::StringId};

mod render;

use render::{BLACK, StrokeJoin, StrokePosition, StrokeSpec, parse_hex_rgba};

#[napi]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ────────────────────────────────────────────────────────────────────────────
// Font source

/// Where to read a face from. Exactly one of `path` / `bytes` is required;
/// `path` wins when both are set.
#[napi(object)]
pub struct FontSource {
    /// Font file on disk. Mapped rather than read, so rasterizing a line of
    /// sample text touches the cmap plus a dozen glyphs instead of paging in
    /// the whole file — a 30MB CJK collection never reaches the JS heap.
    pub path: Option<String>,
    /// Raw SFNT bytes, for faces whose only handle is the Local Font Access
    /// API and which therefore have no path we are allowed to open.
    pub bytes: Option<Buffer>,
    /// Face within a collection (.ttc / .otc). Defaults to 0.
    pub face_index: Option<u32>,
    /// Picks the face out of a collection by name, overriding `face_index`
    /// when it matches. Asking for a system face through the Local Font Access
    /// API yields the bytes of the entire .ttc it lives in, so face 0 is
    /// whichever member the vendor happened to put first — not the one asked
    /// for.
    pub postscript_name: Option<String>,
}

enum FontData {
    Mapped(Mmap),
    Bytes(Buffer),
}

impl FontData {
    fn as_slice(&self) -> &[u8] {
        match self {
            FontData::Mapped(map) => map,
            FontData::Bytes(bytes) => bytes.as_ref(),
        }
    }
}

fn string_equals(font: &FontRef, id: StringId, wanted: &str) -> bool {
    font.localized_strings(id)
        .english_or_first()
        .is_some_and(|s| s.chars().eq(wanted.chars()))
}

fn face_answers_to(font: &FontRef, wanted: &str) -> bool {
    if string_equals(font, StringId::POSTSCRIPT_NAME, wanted) {
        return true;
    }
    // A variable font often carries no face-level PostScript name at all — the
    // platform enumerates its named instances instead, and those instance names
    // are what a font picker ends up asking for.
    font.named_instances().iter().any(|instance| {
        instance
            .postscript_name_id()
            .is_some_and(|id| string_equals(font, id, wanted))
    })
}

fn face_index_by_postscript_name(data: &[u8], wanted: &str) -> Option<u32> {
    let mut index = 0u32;
    while let Ok(font) = FontRef::from_index(data, index) {
        if face_answers_to(&font, wanted) {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn resolve_font(source: FontSource) -> napi::Result<(FontData, u32)> {
    let requested_index = source.face_index;
    let wanted_name = source.postscript_name;

    let data = open_font_data(source.path, source.bytes)?;
    let face_index = wanted_name
        .as_deref()
        .and_then(|name| face_index_by_postscript_name(data.as_slice(), name))
        .or(requested_index)
        .unwrap_or(0);

    Ok((data, face_index))
}

fn open_font_data(path: Option<String>, bytes: Option<Buffer>) -> napi::Result<FontData> {
    if let Some(path) = path {
        let file =
            File::open(&path).map_err(|e| napi::Error::from_reason(format!("open {path}: {e}")))?;
        // SAFETY: truncating or rewriting the file while it is mapped would
        // hand the parsers torn bytes. Installed font files are effectively
        // immutable, and skrifa / harfrust bounds-check every table offset
        // before dereferencing it.
        let map = unsafe { Mmap::map(&file) }
            .map_err(|e| napi::Error::from_reason(format!("mmap {path}: {e}")))?;
        return Ok(FontData::Mapped(map));
    }
    match bytes {
        Some(bytes) => Ok(FontData::Bytes(bytes)),
        None => Err(napi::Error::from_reason(
            "font source requires either path or bytes",
        )),
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Output shapes

#[napi(object)]
pub struct TextBitmap {
    pub width: u32,
    pub height: u32,
    /// Horizontal: distance from top to baseline.
    /// Vertical:   distance from left to column center X.
    pub baseline: f64,
    pub rgba: Buffer,
}

// ────────────────────────────────────────────────────────────────────────────
// Input shapes

#[napi(object)]
pub struct StrokeInput {
    /// Total stroke thickness in pixels (PS convention).
    pub width: f64,
    /// "#RRGGBB" or "#RRGGBBAA".
    pub color: String,
    /// "outside" (default) | "center" | "inside".
    pub position: Option<String>,
    /// "round" (default) | "miter" | "bevel".
    pub join: Option<String>,
}

fn stroke_input_to_spec(input: Option<StrokeInput>) -> napi::Result<Option<StrokeSpec>> {
    let Some(input) = input else { return Ok(None) };
    let color = parse_hex_rgba(&input.color).map_err(napi::Error::from_reason)?;
    let position = match input.position.as_deref().unwrap_or("outside") {
        "outside" => StrokePosition::Outside,
        "center" => StrokePosition::Center,
        "inside" => StrokePosition::Inside,
        other => {
            return Err(napi::Error::from_reason(format!(
                "stroke.position must be outside|center|inside, got {other:?}"
            )));
        }
    };
    let join = match input.join.as_deref().unwrap_or("round") {
        "round" => StrokeJoin::Round,
        "miter" => StrokeJoin::Miter,
        "bevel" => StrokeJoin::Bevel,
        other => {
            return Err(napi::Error::from_reason(format!(
                "stroke.join must be round|miter|bevel, got {other:?}"
            )));
        }
    };
    Ok(Some(StrokeSpec {
        width: input.width as f32,
        color,
        position,
        join,
    }))
}

fn fill_from_opt(fill: Option<String>) -> napi::Result<render::Rgba> {
    match fill {
        None => Ok(BLACK),
        Some(s) => parse_hex_rgba(&s).map_err(napi::Error::from_reason),
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Public functions

#[napi]
pub fn font_covers(font: FontSource, text: String) -> napi::Result<bool> {
    let (data, face_index) = resolve_font(font)?;
    render::font_covers(data.as_slice(), &text, face_index).map_err(napi::Error::from_reason)
}

#[napi]
pub fn render_text(
    font: FontSource,
    text: String,
    size_px: f64,
    padding: Option<u32>,
    fill_color: Option<String>,
    stroke: Option<StrokeInput>,
) -> napi::Result<TextBitmap> {
    let (data, face_index) = resolve_font(font)?;
    let fill = fill_from_opt(fill_color)?;
    let stroke_spec = stroke_input_to_spec(stroke)?;
    let bmp = render::render_text(
        data.as_slice(),
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        face_index,
        fill,
        stroke_spec,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(TextBitmap {
        width: bmp.width,
        height: bmp.height,
        baseline: bmp.baseline as f64,
        rgba: bmp.rgba.into(),
    })
}

#[napi]
pub fn render_vertical(
    font: FontSource,
    text: String,
    size_px: f64,
    padding: Option<u32>,
    fill_color: Option<String>,
    stroke: Option<StrokeInput>,
) -> napi::Result<TextBitmap> {
    let (data, face_index) = resolve_font(font)?;
    let fill = fill_from_opt(fill_color)?;
    let stroke_spec = stroke_input_to_spec(stroke)?;
    let bmp = render::render_vertical(
        data.as_slice(),
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        face_index,
        fill,
        stroke_spec,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(TextBitmap {
        width: bmp.width,
        height: bmp.height,
        baseline: bmp.baseline as f64,
        rgba: bmp.rgba.into(),
    })
}
