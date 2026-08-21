use std::fs::File;
use std::path::PathBuf;

use memmap2::Mmap;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Task};
use napi_derive::napi;
use skrifa::{FontRef, MetadataProvider, string::StringId};

mod encode;
mod enumerate;
mod import;
mod mask;
mod raster;
mod render;
mod stroke;
pub mod tile;

use render::{Align, BLACK, Phase, StrokePosition, StrokeSpec, parse_hex_rgba};

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

/// The frame a render call would come back in, without the pixels. Costs
/// shaping and outlining only — a fraction of a percent of rendering — so a
/// caller sizing a frame need not paint a bitmap it will never draw.
#[napi(object)]
pub struct TextMeasure {
    pub width: u32,
    pub height: u32,
    /// Horizontal: distance from top to baseline.
    /// Vertical:   distance from left to column center X.
    pub baseline: f64,
    /// Position of every cluster, as `render_text` would report it.
    pub clusters: Vec<ClusterRect>,
}

fn to_text_measure(m: render::TextMeasure) -> TextMeasure {
    TextMeasure {
        width: m.width,
        height: m.height,
        baseline: m.baseline as f64,
        clusters: to_cluster_rects(m.clusters),
    }
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
    Ok(Some(StrokeSpec {
        width: input.width as f32,
        color,
        position,
    }))
}

fn fill_from_opt(fill: Option<String>) -> napi::Result<render::Rgba> {
    match fill {
        None => Ok(BLACK),
        Some(s) => parse_hex_rgba(&s).map_err(napi::Error::from_reason),
    }
}

/// A real number, not a flag. Rounding a phase to some number of steps keeps a
/// bitmap cache finite, which is the caller's problem and the caller's constant
/// to choose — putting it here would freeze one answer into the surface.
fn phase_from_opt(x: Option<f64>, y: Option<f64>) -> Phase {
    Phase {
        x: x.unwrap_or(0.0) as f32,
        y: y.unwrap_or(0.0) as f32,
    }
}

fn align_from_opt(align: Option<String>) -> napi::Result<Align> {
    match align.as_deref().unwrap_or("start") {
        "start" => Ok(Align::Start),
        "center" => Ok(Align::Center),
        "end" => Ok(Align::End),
        other => Err(napi::Error::from_reason(format!(
            "align must be start|center|end, got {other:?}"
        ))),
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
    /// usWeightClass, nominally 1–1000 with 400 as regular.
    pub weight: f64,
    /// Width as a percentage of normal, 100 being normal.
    pub width: f64,
    /// Degrees away from upright; 0 is upright, italic and oblique are not.
    pub slant: f64,
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
                weight: face.weight as f64,
                width: face.width as f64,
                slant: face.slant as f64,
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
    rotation: Option<f64>,
    fill_color: Option<String>,
    stroke: Option<StrokeInput>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
    // Moves the fill's own edge, in pixels, positive outward. Thins the
    // strokes when negative, which is the direction a large size needs.
    weight_px: Option<f64>,
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
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
        fill,
        stroke_spec,
        weight_px.unwrap_or(0.0) as f32,
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

/// `render_text` stopped where painting would start. Takes only the arguments
/// that shape the frame — colours, stroke and weight cannot move it, though the
/// padding sized for them can, and that stays the caller's to pass.
#[napi]
pub fn measure_text(
    font: FontSource,
    text: String,
    size_px: f64,
    padding: Option<u32>,
    rotation: Option<f64>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
) -> napi::Result<TextMeasure> {
    let (data, face_index) = resolve_font(font)?;
    let m = render::measure_text(
        data.as_slice(),
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        face_index,
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(to_text_measure(m))
}

// ────────────────────────────────────────────────────────────────────────────
// Delivery encoding

#[napi(object)]
pub struct EncodeInput {
    /// "png" | "png-8" | "jpeg" | "webp".
    pub format: String,
    /// "color" | "grayscale" | "bilevel".
    pub color_mode: String,
    /// Ceiling in bytes. Only honoured by formats with something to turn
    /// towards it; the result is the smallest attempt when nothing fits.
    pub max_bytes: Option<u32>,
    /// Where a JPEG quality search starts, 1..=100. Defaults to 90.
    pub quality: Option<u32>,
}

fn encode_input_to_spec(input: EncodeInput) -> napi::Result<encode::EncodeSpec> {
    let format = match input.format.as_str() {
        "png" => encode::Format::Png,
        "png-8" => encode::Format::Png8,
        "jpeg" => encode::Format::Jpeg,
        "webp" => encode::Format::Webp,
        other => {
            return Err(napi::Error::from_reason(format!(
                "format must be png|png-8|jpeg|webp, got {other:?}"
            )));
        }
    };
    let color_mode = match input.color_mode.as_str() {
        "color" => encode::ColorMode::Color,
        "grayscale" => encode::ColorMode::Grayscale,
        "bilevel" => encode::ColorMode::Bilevel,
        other => {
            return Err(napi::Error::from_reason(format!(
                "colorMode must be color|grayscale|bilevel, got {other:?}"
            )));
        }
    };
    if color_mode == encode::ColorMode::Bilevel && format != encode::Format::Png {
        return Err(napi::Error::from_reason(
            "bilevel is only available as PNG; no other format here carries a 1-bit image",
        ));
    }
    Ok(encode::EncodeSpec {
        format,
        color_mode,
        max_bytes: input.max_bytes.map(|b| b as usize),
        quality: input.quality.unwrap_or(90).clamp(1, 100) as u8,
    })
}

/// A finished page as file bytes. Takes straight RGBA, because the compositing
/// this encodes happens on a canvas in the renderer — what it writes is what
/// the application just drew, so this path has nothing to decode.
#[napi]
pub fn encode_image(
    rgba: Buffer,
    width: u32,
    height: u32,
    input: EncodeInput,
) -> napi::Result<Buffer> {
    let spec = encode_input_to_spec(input)?;
    let bytes =
        encode::encode(rgba.as_ref(), width, height, &spec).map_err(napi::Error::from_reason)?;
    Ok(bytes.into())
}

// ────────────────────────────────────────────────────────────────────────────
// Raster layers
//
// Unlike everything above, these calls are stateful: the engine holds a layer's
// pixels between them. A layer is handed over whole on its first edit and let go
// when the page is turned, so "does the engine have this" is a moment rather
// than something anyone has to infer from what happened earlier.

/// A rectangle in page pixels.
#[napi(object)]
pub struct LayerFrame {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn to_rect(frame: &LayerFrame) -> raster::Rect {
    raster::Rect {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
    }
}

fn to_frame(rect: raster::Rect) -> LayerFrame {
    LayerFrame {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
    }
}

/// What a write left behind.
#[napi(object)]
pub struct LayerPatch {
    /// What to name when asking for this write to be taken back. Empty on a
    /// patch that came from applying a record, since applying it again is what
    /// puts it back and the caller already knows which record it asked for.
    pub journal: String,
    /// The layer's frame after the write. A write reaching past an edge moves
    /// it, and the manifest has to be told.
    pub frame: LayerFrame,
    /// The part of the page `rgba` describes. Equal to `frame` whenever the
    /// frame moved, because a picture of the old size has nowhere to put a
    /// patch of the new one.
    pub changed: LayerFrame,
    /// Straight RGBA of `changed`, row-major.
    pub rgba: Buffer,
}

fn to_patch(journal: String, patch: raster::Patch) -> LayerPatch {
    LayerPatch {
        journal,
        frame: to_frame(patch.frame),
        changed: to_frame(patch.changed),
        rgba: patch.rgba.into(),
    }
}

/// A layer's pixels over part of itself, and where its frame stands.
///
/// What a write hands back minus the way to take it back — which is exactly
/// what a preview is, so both reach the caller's own picture of a layer by one
/// path instead of two.
#[napi(object)]
pub struct LayerPixels {
    /// Where the layer's frame would stand were this committed.
    pub frame: LayerFrame,
    /// The part of the page `rgba` describes. Equal to `frame` whenever that
    /// frame moved, because a picture of the old size has nowhere to put a
    /// patch of the new one.
    pub changed: LayerFrame,
    /// Straight RGBA of `changed`, row-major.
    pub rgba: Buffer,
}

fn to_pixels(shown: raster::Preview) -> LayerPixels {
    LayerPixels {
        frame: to_frame(shown.frame),
        changed: to_frame(shown.changed),
        rgba: shown.rgba.into(),
    }
}

/// Hands a layer's whole pixels over, to be called once on its first edit.
///
/// Whole rather than lazily, and once rather than per region: the crossing costs
/// about 40 ms for a full page layer against three orders of magnitude of
/// headroom, and it buys the guarantee that the engine and the renderer never
/// hold two answers to what a layer contains.
#[napi]
pub fn raster_take(id: String, rgba: Buffer, frame: LayerFrame) -> napi::Result<()> {
    raster::take(&id, rgba.as_ref(), to_rect(&frame)).map_err(napi::Error::from_reason)
}

#[napi]
pub fn raster_holds(id: String) -> bool {
    raster::holds(&id)
}

#[napi]
pub fn raster_release(id: String) {
    raster::release(&id);
}

/// Lets go of every held layer. Turning the page.
#[napi]
pub fn raster_release_all() {
    raster::release_all();
}

/// Fills the covered part of `mask` with `color` on a held layer.
///
/// `mask` is A8 coverage over `maskFrame` in page pixels. Nothing comes back
/// when the coverage is empty or the colour fully transparent — a write that
/// changes nothing is not a step worth being able to take back.
///
/// `alphaLocked` is the layer's own switch: paint lands only where there is
/// already coverage, and the alpha it lands on is left where it was.
#[napi]
pub fn raster_fill(
    id: String,
    mask: Buffer,
    mask_frame: LayerFrame,
    color: String,
    alpha_locked: bool,
) -> napi::Result<Option<LayerPatch>> {
    let rgba = parse_hex_rgba(&color).map_err(napi::Error::from_reason)?;
    let filled = raster::fill(
        &id,
        mask.as_ref(),
        to_rect(&mask_frame),
        [rgba.0, rgba.1, rgba.2, rgba.3],
        alpha_locked,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(filled.map(|(journal, patch)| to_patch(journal, patch)))
}

/// Takes the covered part of `mask` out of a held layer, in one transaction
/// against its tiles.
///
/// The same machinery as a fill with one operator swapped, and always all the
/// way through: an eraser that stopped at the layer below would be a second kind
/// of transparency, and there is only one. Null when the coverage is empty.
#[napi]
pub fn raster_erase(
    id: String,
    mask: Buffer,
    mask_frame: LayerFrame,
) -> napi::Result<Option<LayerPatch>> {
    let erased = raster::erase(&id, mask.as_ref(), to_rect(&mask_frame))
        .map_err(napi::Error::from_reason)?;
    Ok(erased.map(|(journal, patch)| to_patch(journal, patch)))
}

/// A held layer's own pixels over a rectangle of the page, straight RGBA, row
/// by row. Ground the layer does not cover reads as transparent, so a rectangle
/// reaching past its frame is answered rather than refused.
#[napi]
pub fn raster_read(id: String, region: LayerFrame) -> napi::Result<Buffer> {
    let rgba = raster::read(&id, to_rect(&region)).map_err(napi::Error::from_reason)?;
    Ok(rgba.into())
}

/// Starts a run of previews against a layer: the frame they stand on begins
/// again from the committed one. Called as a stroke begins.
#[napi]
pub fn raster_preview_begin(id: String) {
    raster::preview_begin(&id);
}

/// What a fill would leave, worked out and handed back with nothing committed:
/// no tile moves, no frame moves and no record is filed.
///
/// The same three things a write hands back, so a preview reaches the caller's
/// own picture of the layer by the path a write already uses. `frame` is where
/// the frame would stand if the stroke were released now — worked out here,
/// because a frame is the engine's to name and a caller that arrived at its own
/// answer would be a second authority on the same rectangle.
///
/// `changed` is `maskFrame` while that frame stands still and the whole frame
/// when it moves, which is the rule a committed write already follows.
#[napi]
pub fn raster_preview_fill(
    id: String,
    mask: Buffer,
    mask_frame: LayerFrame,
    color: String,
    alpha_locked: bool,
) -> napi::Result<Option<LayerPixels>> {
    let rgba = parse_hex_rgba(&color).map_err(napi::Error::from_reason)?;
    let shown = raster::preview_fill(
        &id,
        mask.as_ref(),
        to_rect(&mask_frame),
        [rgba.0, rgba.1, rgba.2, rgba.3],
        alpha_locked,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(shown.map(to_pixels))
}

/// What an erase would leave, on the same terms.
#[napi]
pub fn raster_preview_erase(
    id: String,
    mask: Buffer,
    mask_frame: LayerFrame,
) -> napi::Result<Option<LayerPixels>> {
    let shown = raster::preview_erase(&id, mask.as_ref(), to_rect(&mask_frame))
        .map_err(napi::Error::from_reason)?;
    Ok(shown.map(to_pixels))
}

/// Swaps a record against its layer. Undo and redo are this same call, because
/// swapping is its own inverse. Nothing comes back when the record or its layer
/// has been let go.
#[napi]
pub fn raster_apply_journal(journal: String) -> Option<LayerPatch> {
    raster::apply_journal(&journal).map(|patch| to_patch(String::new(), patch))
}

/// Forgets a record — what history falling off the bottom means.
#[napi]
pub fn raster_drop_journal(journal: String) {
    raster::drop_journal(&journal);
}

/// What pixel history is holding in memory right now.
///
/// Asked here rather than worked out by whatever holds the undo stack: a block
/// shared between records looks like two from outside and is one from inside,
/// and only inside can count it right. A select-all mask is tens of thousands
/// of coordinates pointing at one block, and a caller adding up its own
/// commands would report hundreds of megabytes for four kilobytes.
/// A double rather than a u32: history is bounded in the hundreds of megabytes
/// but nothing stops a ceiling being set past four gigabytes, and a count that
/// silently wrapped there would report almost nothing at the exact moment it
/// mattered most.
#[napi]
pub fn raster_history_bytes() -> f64 {
    raster::history_bytes() as f64
}

/// Drops the oldest records until history is under `ceiling` bytes, keeping at
/// least `floor` of them whatever they weigh, and names what it dropped.
///
/// Call before a write, never after. Building the new record first and pruning
/// afterwards is how a stack peaks at its ceiling plus a whole canvas.
///
/// Everything named here is gone; a caller holding an undo stack has to drop
/// those steps and everything under them, since history is linear and a step
/// whose pixels are gone cannot be reached past.
#[napi]
pub fn raster_trim_history(floor: u32, ceiling: f64) -> Vec<String> {
    raster::trim_history(floor as usize, ceiling.max(0.0) as usize)
}

// ────────────────────────────────────────────────────────────────────────────
// The selection
//
// One selection at a time, on the same grid the pixels use — one byte a pixel
// instead of four. Every mutation hands back the name of a record that puts it
// back, page and size and edges included, so undoing across a page change is the
// same step as undoing a marquee.

/// Which page the selection is on, how big that page is, and where its edges
/// are.
///
/// One call rather than three, because a caller that has any of them wants all
/// of them: they change together, and asking separately is three chances to act
/// on a half-updated answer.
#[napi(object)]
pub struct MaskState {
    /// Null when nothing is selected anywhere.
    pub page: Option<String>,
    pub width: i32,
    pub height: i32,
    /// The tight box of everything selected, or null when nothing is.
    pub bounds: Option<LayerFrame>,
}

#[napi]
pub fn mask_state() -> MaskState {
    let (width, height) = mask::size();
    MaskState {
        page: mask::page(),
        width,
        height,
        bounds: mask::bounds().map(to_frame),
    }
}

/// The selection's own bytes over a rectangle, row by row, one per pixel.
///
/// Zero where nothing is selected, which is what the absence of a tile already
/// means. Anything outside the page reads as zero too.
#[napi]
pub fn mask_read(region: LayerFrame) -> Buffer {
    mask::read(to_rect(&region)).into()
}

/// Starts an empty selection for a page, putting away whatever was held.
#[napi]
pub fn mask_hold(page: String, width: i32, height: i32) -> String {
    mask::hold(&page, width, height)
}

/// Nothing selected anywhere.
#[napi]
pub fn mask_deselect() -> String {
    mask::deselect()
}

/// Writes coverage over a region and works out where the edges are now.
///
/// `bytes` is one per pixel of `region`, row by row. The part of the region
/// outside the page is dropped — a selection is measured in page pixels, and
/// there is nothing outside them to select.
#[napi]
pub fn mask_write(region: LayerFrame, bytes: Buffer) -> napi::Result<String> {
    mask::write(to_rect(&region), bytes.as_ref()).map_err(napi::Error::from_reason)
}

/// Every pixel of the page selected, as one block hung at every coordinate it
/// covers. This is where the bill collapses: a full-page mask is 139 MB at the
/// largest page, and this is four kilobytes and a list of pointers.
#[napi]
pub fn mask_select_all() -> String {
    mask::select_all()
}

/// Every value turned over, feathered edges included.
#[napi]
pub fn mask_invert() -> String {
    mask::invert()
}

/// Swaps a record against the selection. Undo and redo are this same call.
#[napi]
pub fn mask_apply_journal(journal: String) {
    mask::apply_journal(&journal);
}

#[napi]
pub fn mask_drop_journal(journal: String) {
    mask::drop_journal(&journal);
}

/// Folds a later record into an earlier one and forgets the later.
///
/// A brush stroke is one step however many segments it is made of, so its
/// segments write one after another and their records collapse into the first.
/// Without this a stroke of two hundred segments would hold two hundred copies
/// of every tile it crossed.
#[napi]
pub fn mask_absorb_journal(into: String, later: String) {
    mask::absorb_journal(&into, &later);
}

/// What the selection and its records are holding, counting a shared block once.
#[napi]
pub fn mask_bytes_held() -> f64 {
    mask::bytes_held() as f64
}

/// Everything forgotten. A selection belongs to the project that made it, and
/// two projects can hold a page of the same name.
#[napi]
pub fn mask_reset() {
    mask::reset();
}

// ────────────────────────────────────────────────────────────────────────────
// Source import

/// The size a page takes from the image it was created with.
#[napi(object)]
pub struct BaseMapSize {
    pub width: u32,
    pub height: u32,
}

pub struct ImportBaseMap {
    source: PathBuf,
    dest: PathBuf,
}

impl Task for ImportBaseMap {
    type Output = import::BaseMap;
    type JsValue = BaseMapSize;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        import::import_base_map(&self.source, &self.dest).map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(BaseMapSize {
            width: output.width,
            height: output.height,
        })
    }
}

/// Copies a source image into a page as its base map: a PNG of the same pixels
/// at `destPath`, decoded exactly once and never again.
///
/// Two paths and no buffer. Electron refuses an ArrayBuffer over memory outside
/// the V8 heap and caps a single allocation at 2GiB, both of which bind a native
/// addon handing pixels to JavaScript — so this hands none over, and Chromium
/// reads the result off disk the way it reads every other layer.
///
/// Refuses a source whose bytes are not really on this machine and one that
/// stops before its format's end marker, either of which would otherwise decode
/// into a page that is quietly half grey.
///
/// Runs off the JavaScript thread: a page-sized decode and re-encode is far too
/// much to do between frames.
#[napi(ts_return_type = "Promise<BaseMapSize>")]
pub fn import_base_map(source_path: String, dest_path: String) -> AsyncTask<ImportBaseMap> {
    AsyncTask::new(ImportBaseMap {
        source: PathBuf::from(source_path),
        dest: PathBuf::from(dest_path),
    })
}

#[napi]
pub fn render_vertical(
    font: FontSource,
    text: String,
    size_px: f64,
    padding: Option<u32>,
    rotation: Option<f64>,
    fill_color: Option<String>,
    stroke: Option<StrokeInput>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
    // Moves the fill's own edge, in pixels, positive outward. Thins the
    // strokes when negative, which is the direction a large size needs.
    weight_px: Option<f64>,
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
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
        fill,
        stroke_spec,
        weight_px.unwrap_or(0.0) as f32,
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

/// `render_vertical` stopped where painting would start.
#[napi]
pub fn measure_vertical(
    font: FontSource,
    text: String,
    size_px: f64,
    padding: Option<u32>,
    rotation: Option<f64>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
) -> napi::Result<TextMeasure> {
    let (data, face_index) = resolve_font(font)?;
    let m = render::measure_vertical(
        data.as_slice(),
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        face_index,
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(to_text_measure(m))
}

/// A grid of boxes to draw where a text object names a family this machine has
/// no face for. Takes the text but no font: the characters and line breaks are
/// still known, and they are what the grid is shaped by.
#[napi]
pub fn render_notdef(
    text: String,
    size_px: f64,
    padding: Option<u32>,
    vertical: Option<bool>,
    rotation: Option<f64>,
    fill_color: Option<String>,
    stroke: Option<StrokeInput>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
    // Moves the fill's own edge, in pixels, positive outward. Thins the
    // strokes when negative, which is the direction a large size needs.
    weight_px: Option<f64>,
) -> napi::Result<TextBitmap> {
    let fill = fill_from_opt(fill_color)?;
    let stroke_spec = stroke_input_to_spec(stroke)?;
    let bmp = render::render_notdef(
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        vertical.unwrap_or(false),
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
        fill,
        stroke_spec,
        weight_px.unwrap_or(0.0) as f32,
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

/// `render_notdef` stopped where painting would start.
#[napi]
pub fn measure_notdef(
    text: String,
    size_px: f64,
    padding: Option<u32>,
    vertical: Option<bool>,
    rotation: Option<f64>,
    phase_x: Option<f64>,
    phase_y: Option<f64>,
    align: Option<String>,
) -> napi::Result<TextMeasure> {
    let m = render::measure_notdef(
        &text,
        size_px as f32,
        padding.unwrap_or(4),
        vertical.unwrap_or(false),
        rotation.unwrap_or(0.0) as f32,
        phase_from_opt(phase_x, phase_y),
        align_from_opt(align)?,
    );
    Ok(to_text_measure(m))
}
