use std::fs::File;
use std::path::PathBuf;

use memmap2::Mmap;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Task};
use napi_derive::napi;
use skrifa::{FontRef, MetadataProvider, string::StringId};

mod enumerate;
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

/// Where one cluster of the input string landed on the bitmap.
#[napi(object)]
pub struct ClusterRect {
    /// Byte offset of the cluster's first character in the input string.
    pub cluster: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct TextBitmap {
    pub width: u32,
    pub height: u32,
    /// Horizontal: distance from top to baseline.
    /// Vertical:   distance from left to column center X.
    pub baseline: f64,
    pub rgba: Buffer,
    /// Position of every cluster, for callers that need to point at individual
    /// characters once the text is a bitmap.
    pub clusters: Vec<ClusterRect>,
}

fn to_cluster_rects(rects: Vec<render::ClusterRect>) -> Vec<ClusterRect> {
    rects
        .into_iter()
        .map(|r| ClusterRect {
            cluster: r.cluster,
            x: r.x as f64,
            y: r.y as f64,
            width: r.width as f64,
            height: r.height as f64,
        })
        .collect()
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
// Enumeration

/// One face of one font file, as found on disk.
#[napi(object)]
pub struct FaceInfo {
    /// Locale-independent family name. This is the identity a project file
    /// stores, so it must not follow whoever happens to be reading.
    pub family: String,
    /// Same family in the reader's language when the font carries one.
    pub display_name: String,
    pub style: String,
    pub postscript_name: String,
    pub path: String,
    pub face_index: u32,
}

pub struct ScanFonts {
    dirs: Vec<PathBuf>,
    locales: Vec<String>,
}

impl Task for ScanFonts {
    type Output = Vec<enumerate::FaceInfo>;
    type JsValue = Vec<FaceInfo>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(enumerate::scan(&self.dirs, &self.locales))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(|face| FaceInfo {
                family: face.family,
                display_name: face.display_name,
                style: face.style,
                postscript_name: face.postscript_name,
                path: face.path,
                face_index: face.face_index,
            })
            .collect())
    }
}

/// Every face found under `dirs`, or under the platform's font directories
/// when `dirs` is omitted. `locales` orders the languages a display name is
/// preferred in, most wanted first.
///
/// Runs off the JavaScript thread: opening a thousand font files is far too
/// much to do between frames.
#[napi(ts_return_type = "Promise<FaceInfo[]>")]
pub fn list_fonts(dirs: Option<Vec<String>>, locales: Option<Vec<String>>) -> AsyncTask<ScanFonts> {
    AsyncTask::new(ScanFonts {
        dirs: match dirs {
            Some(dirs) => dirs.into_iter().map(PathBuf::from).collect(),
            None => enumerate::default_dirs(),
        },
        locales: locales.unwrap_or_default(),
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Public functions

/// Byte offsets of the characters this face has no glyph for. Empty means the
/// face can draw the whole string; whitespace never counts as missing.
#[napi]
pub fn uncovered_clusters(font: FontSource, text: String) -> napi::Result<Vec<u32>> {
    let (data, face_index) = resolve_font(font)?;
    render::uncovered_clusters(data.as_slice(), &text, face_index).map_err(napi::Error::from_reason)
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
        clusters: to_cluster_rects(bmp.clusters),
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
        clusters: to_cluster_rects(bmp.clusters),
    })
}
