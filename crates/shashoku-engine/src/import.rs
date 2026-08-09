//! Turning a source image into a page's base map.
//!
//! File in, file out — the pixels never reach JavaScript. Electron forbids an
//! ArrayBuffer over memory outside the V8 heap and caps a single allocation at
//! 2GiB; both apply to a native addon handing a large buffer across, and
//! neither applies here because nothing is handed across.
//!
//! The decode happens once, here, and never again: what lands in `layers/` is
//! the pixels a retouch or an erase patch will later be measured against, so a
//! base map that were re-decoded on every open could drift out from under them.

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

use image::ImageDecoder;
use image::codecs::jpeg::JpegDecoder;
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use png::{BitDepth, ColorType, Encoder, Info};

/// What a page learns about itself from the image it was created with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BaseMap {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Webp,
}

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// How a complete PNG ends: the IEND chunk's type followed by the CRC that a
/// zero-length payload always produces. The spec puts nothing after it.
const PNG_END: &[u8] = b"IEND\xae\x42\x60\x82";

/// How far back a JPEG's EOI is allowed to sit. Writers exist that leave
/// padding or a thumbnail after the marker, and refusing those would be
/// mistaking a whole file for a half-written one; a file still being written
/// has no EOI anywhere.
const JPEG_END_WINDOW: usize = 64;

fn sniff(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(PNG_SIGNATURE) {
        return Some(Format::Png);
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some(Format::Jpeg);
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(Format::Webp);
    }
    None
}

/// Whether the file has the end its format says it should have. A truncated
/// JPEG is the reason this exists: it very often decodes without complaint and
/// simply comes out grey from the cut down.
fn ends_where_it_should(format: Format, bytes: &[u8]) -> bool {
    match format {
        Format::Png => bytes.ends_with(PNG_END),
        Format::Jpeg => {
            let tail = &bytes[bytes.len().saturating_sub(JPEG_END_WINDOW)..];
            tail.windows(2).any(|pair| pair == b"\xff\xd9")
        }
        Format::Webp => {
            // RIFF's size field counts everything after itself, so a complete
            // file is at least the eight bytes ahead of it plus that.
            let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
            bytes.len() >= declared.saturating_add(8)
        }
    }
}

/// A cloud provider leaves a file of the right size whose bytes live elsewhere.
/// Reading one yields zeroes or a stall rather than an error, so the length
/// cannot be trusted on its own.
#[cfg(unix)]
fn holds_no_blocks(meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    meta.len() > 0 && meta.blocks() == 0
}

/// Windows has no equivalent signal and needs none: its cloud filter driver
/// hydrates a placeholder during the read, so what arrives is the whole file
/// or an error, never a silent truncation.
#[cfg(not(unix))]
fn holds_no_blocks(_meta: &fs::Metadata) -> bool {
    false
}

/// The profile as the source carried it, or nothing. A profile that fails to
/// come out is treated as absent rather than fatal: a page without one is what
/// every source without one already produces, and it renders as sRGB.
fn take(mut decoder: impl ImageDecoder) -> Result<(image::DynamicImage, Option<Vec<u8>>), String> {
    let icc = decoder
        .icc_profile()
        .ok()
        .flatten()
        .filter(|profile| !profile.is_empty());
    let image = image::DynamicImage::from_decoder(decoder).map_err(|e| format!("decode: {e}"))?;
    Ok((image, icc))
}

fn decode(
    format: Format,
    bytes: Vec<u8>,
) -> Result<(image::DynamicImage, Option<Vec<u8>>), String> {
    let read = std::io::Cursor::new(bytes);
    match format {
        Format::Png => take(PngDecoder::new(read).map_err(|e| format!("png: {e}"))?),
        Format::Jpeg => take(JpegDecoder::new(read).map_err(|e| format!("jpeg: {e}"))?),
        Format::Webp => take(WebPDecoder::new(read).map_err(|e| format!("webp: {e}"))?),
    }
}

/// Beside the destination rather than in the system temp directory, so the
/// rename that follows stays within one filesystem and is therefore atomic.
fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}

fn write_png(
    dest: &Path,
    rgba: &[u8],
    width: u32,
    height: u32,
    icc: Option<Vec<u8>>,
) -> Result<(), String> {
    let mut out = Vec::new();
    let mut info = Info::with_size(width, height);
    info.color_type = ColorType::Rgba;
    info.bit_depth = BitDepth::Eight;
    info.icc_profile = icc.map(Cow::Owned);
    {
        let encoder = Encoder::with_info(&mut out, info).map_err(|e| format!("png header: {e}"))?;
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png header: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("png data: {e}"))?;
        writer.finish().map_err(|e| format!("png finish: {e}"))?;
    }

    // Through a neighbour and a rename: a base map that appeared half-written
    // would be a broken page with nothing to report it.
    let part = part_path(dest);
    fs::write(&part, &out).map_err(|e| format!("write {}: {e}", part.display()))?;
    fs::rename(&part, dest).map_err(|e| {
        let _ = fs::remove_file(&part);
        format!("rename onto {}: {e}", dest.display())
    })
}

/// Reads `source`, writes `dest` as a PNG of the same pixels, and reports the
/// size the page therefore has.
///
/// PNG because it is lossless, so the pixels the page keeps are exactly the
/// ones this decode produced — and RGBA because that is the shape a canvas
/// composites in. Whether an opaque grayscale source deserves a narrower PNG is
/// a question about storage, and it can be answered later without moving a
/// pixel.
pub fn import_base_map(source: &Path, dest: &Path) -> Result<BaseMap, String> {
    let meta = fs::metadata(source).map_err(|e| format!("read {}: {e}", source.display()))?;
    if holds_no_blocks(&meta) {
        return Err(format!(
            "{}: the bytes are not on this machine — the file is a cloud placeholder",
            source.display()
        ));
    }

    let bytes = fs::read(source).map_err(|e| format!("read {}: {e}", source.display()))?;
    let Some(format) = sniff(&bytes) else {
        return Err(format!("{}: not PNG, JPEG or WebP", source.display()));
    };
    if !ends_where_it_should(format, &bytes) {
        return Err(format!(
            "{}: the file stops before its end marker, so it is still being written",
            source.display()
        ));
    }

    let (image, icc) = decode(format, bytes)?;
    let rgba = image.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    write_png(dest, rgba.as_raw(), width, height, icc)?;
    Ok(BaseMap { width, height })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ExtendedColorType, ImageEncoder};
    use std::sync::atomic::{AtomicU32, Ordering};

    // ── scratch space ───────────────────────────────────────────────────────

    static NEXT_SCRATCH: AtomicU32 = AtomicU32::new(0);

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let n = NEXT_SCRATCH.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("shashoku-import-{}-{n}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn at(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }

        fn holding(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.at(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /// Varied enough that a lossy codec cannot collapse it to one colour and a
    /// palette has something to learn.
    fn pixels(width: u32, height: u32, alpha: bool) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                rgba.push((x * 255 / width.max(1)) as u8);
                rgba.push((y * 255 / height.max(1)) as u8);
                rgba.push(((x ^ y) & 0xff) as u8);
                rgba.push(if alpha {
                    (x * 255 / width.max(1)) as u8
                } else {
                    255
                });
            }
        }
        rgba
    }

    fn source_png(width: u32, height: u32, rgba: &[u8], icc: Option<&[u8]>) -> Vec<u8> {
        let mut out = Vec::new();
        let mut info = Info::with_size(width, height);
        info.color_type = ColorType::Rgba;
        info.bit_depth = BitDepth::Eight;
        info.icc_profile = icc.map(|p| Cow::Owned(p.to_vec()));
        let encoder = Encoder::with_info(&mut out, info).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(rgba).unwrap();
        writer.finish().unwrap();
        out
    }

    fn source_jpeg(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
        let rgb: Vec<u8> = rgba
            .chunks_exact(4)
            .flat_map(|px| [px[0], px[1], px[2]])
            .collect();
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95)
            .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    fn source_webp(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut out)
            .write_image(rgba, width, height, ExtendedColorType::Rgba8)
            .unwrap();
        out
    }

    /// Splices an ICC profile into a JPEG as APP2 segments, `per_segment`
    /// profile bytes at a time — which is how a profile larger than the 64KiB
    /// a segment can hold arrives in a real file.
    fn with_icc(jpeg: &[u8], profile: &[u8], per_segment: usize) -> Vec<u8> {
        let chunks: Vec<&[u8]> = profile.chunks(per_segment).collect();
        let count = chunks.len() as u8;
        let mut out = Vec::with_capacity(jpeg.len() + profile.len() + 32 * chunks.len());
        out.extend_from_slice(&jpeg[..2]); // SOI
        for (i, chunk) in chunks.iter().enumerate() {
            let payload_len = 2 + 12 + 2 + chunk.len();
            out.extend_from_slice(&[0xff, 0xe2]);
            out.extend_from_slice(&(payload_len as u16).to_be_bytes());
            out.extend_from_slice(b"ICC_PROFILE\0");
            out.push(i as u8 + 1);
            out.push(count);
            out.extend_from_slice(chunk);
        }
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    /// A profile only has to be carried, not understood, so the bytes need only
    /// be recognisable — nothing on this path parses them.
    fn profile(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    // ── reading the result back ─────────────────────────────────────────────

    struct Written {
        width: u32,
        height: u32,
        color_type: ColorType,
        icc: Option<Vec<u8>>,
        rgba: Vec<u8>,
    }

    fn read_back(path: &Path) -> Written {
        let bytes = fs::read(path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
        let mut reader = png::Decoder::new(std::io::Cursor::new(&bytes))
            .read_info()
            .unwrap();
        let icc = reader.info().icc_profile.clone().map(|p| p.into_owned());
        let color_type = reader.info().color_type;
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut buf).unwrap();
        buf.truncate(frame.buffer_size());
        Written {
            width: frame.width,
            height: frame.height,
            color_type,
            icc,
            rgba: buf,
        }
    }

    // ── what comes out ──────────────────────────────────────────────────────

    #[test]
    fn a_png_source_arrives_pixel_for_pixel() {
        let scratch = Scratch::new();
        let rgba = pixels(16, 9, true);
        let source = scratch.holding("in.png", &source_png(16, 9, &rgba, None));
        let dest = scratch.at("out.png");

        let size = import_base_map(&source, &dest).unwrap();

        assert_eq!(
            size,
            BaseMap {
                width: 16,
                height: 9
            }
        );
        let written = read_back(&dest);
        assert_eq!((written.width, written.height), (16, 9));
        assert_eq!(written.color_type, ColorType::Rgba);
        assert_eq!(written.rgba, rgba);
    }

    #[test]
    fn a_jpeg_source_becomes_a_png_of_the_same_size() {
        let scratch = Scratch::new();
        let source = scratch.holding("in.jpg", &source_jpeg(24, 12, &pixels(24, 12, false)));
        let dest = scratch.at("out.png");

        let size = import_base_map(&source, &dest).unwrap();

        assert_eq!(
            size,
            BaseMap {
                width: 24,
                height: 12
            }
        );
        let written = read_back(&dest);
        assert_eq!((written.width, written.height), (24, 12));
        // JPEG has no alpha, so every pixel it hands over is opaque.
        assert!(written.rgba.chunks_exact(4).all(|px| px[3] == 255));
    }

    #[test]
    fn a_webp_source_becomes_a_png_of_the_same_size() {
        let scratch = Scratch::new();
        let rgba = pixels(20, 10, true);
        let source = scratch.holding("in.webp", &source_webp(20, 10, &rgba));
        let dest = scratch.at("out.png");

        let size = import_base_map(&source, &dest).unwrap();

        assert_eq!(
            size,
            BaseMap {
                width: 20,
                height: 10
            }
        );
        assert_eq!(read_back(&dest).rgba, rgba);
    }

    // ── colour description rides along ──────────────────────────────────────

    #[test]
    fn a_png_profile_moves_across_untouched() {
        let scratch = Scratch::new();
        let icc = profile(600);
        let source = scratch.holding(
            "in.png",
            &source_png(8, 8, &pixels(8, 8, false), Some(&icc)),
        );
        let dest = scratch.at("out.png");

        import_base_map(&source, &dest).unwrap();

        assert_eq!(read_back(&dest).icc, Some(icc));
    }

    #[test]
    fn a_jpeg_profile_moves_across_untouched() {
        let scratch = Scratch::new();
        let icc = profile(600);
        let jpeg = with_icc(&source_jpeg(8, 8, &pixels(8, 8, false)), &icc, 600);
        let source = scratch.holding("in.jpg", &jpeg);
        let dest = scratch.at("out.png");

        import_base_map(&source, &dest).unwrap();

        assert_eq!(read_back(&dest).icc, Some(icc));
    }

    /// A profile past 64KiB cannot fit in one APP2 segment, so a real one
    /// arrives numbered and split. Verified here rather than assumed: the
    /// reassembly is the decoder's, and getting it wrong would hand Chromium a
    /// truncated profile that it would apply anyway.
    #[test]
    fn a_jpeg_profile_split_across_segments_arrives_whole() {
        let scratch = Scratch::new();
        let icc = profile(200_000);
        let jpeg = with_icc(&source_jpeg(8, 8, &pixels(8, 8, false)), &icc, 65_000);
        let source = scratch.holding("in.jpg", &jpeg);
        let dest = scratch.at("out.png");

        import_base_map(&source, &dest).unwrap();

        assert_eq!(read_back(&dest).icc, Some(icc));
    }

    #[test]
    fn no_profile_means_no_chunk() {
        let scratch = Scratch::new();
        let source = scratch.holding("in.png", &source_png(8, 8, &pixels(8, 8, false), None));
        let dest = scratch.at("out.png");

        import_base_map(&source, &dest).unwrap();

        assert_eq!(read_back(&dest).icc, None);
    }

    // ── what gets refused ───────────────────────────────────────────────────

    #[test]
    fn a_jpeg_cut_short_of_its_end_marker_is_refused() {
        let scratch = Scratch::new();
        let whole = source_jpeg(64, 64, &pixels(64, 64, false));
        let source = scratch.holding("in.jpg", &whole[..whole.len() * 2 / 3]);
        let dest = scratch.at("out.png");

        let err = import_base_map(&source, &dest).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert!(!dest.exists(), "a refused source left a file behind");
    }

    #[test]
    fn a_png_cut_short_of_its_end_marker_is_refused() {
        let scratch = Scratch::new();
        let whole = source_png(64, 64, &pixels(64, 64, false), None);
        let source = scratch.holding("in.png", &whole[..whole.len() - 4]);
        let dest = scratch.at("out.png");

        let err = import_base_map(&source, &dest).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert!(!dest.exists(), "a refused source left a file behind");
    }

    #[test]
    fn a_webp_shorter_than_its_header_promises_is_refused() {
        let scratch = Scratch::new();
        let whole = source_webp(64, 64, &pixels(64, 64, false));
        let source = scratch.holding("in.webp", &whole[..whole.len() - 32]);
        let dest = scratch.at("out.png");

        let err = import_base_map(&source, &dest).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert!(!dest.exists(), "a refused source left a file behind");
    }

    /// A cloud provider leaves a file the right size whose bytes are elsewhere.
    /// Reading it hands back zeroes or a stall, never an error, so the size on
    /// its own cannot be trusted — the block count is what gives it away.
    #[cfg(unix)]
    #[test]
    fn a_file_holding_no_blocks_is_refused_as_a_placeholder() {
        let scratch = Scratch::new();
        let path = scratch.at("in.jpg");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(4_000_000)
            .unwrap();
        let dest = scratch.at("out.png");

        let err = import_base_map(&path, &dest).unwrap_err();

        assert!(err.contains("not on this machine"), "{err}");
    }

    #[test]
    fn a_format_nothing_here_reads_is_refused() {
        let scratch = Scratch::new();
        let source = scratch.holding("in.tif", b"II*\0\x08\0\0\0not really a tiff either");
        let dest = scratch.at("out.png");

        let err = import_base_map(&source, &dest).unwrap_err();

        assert!(err.contains("PNG, JPEG or WebP"), "{err}");
    }

    #[test]
    fn a_source_that_is_not_there_is_refused() {
        let scratch = Scratch::new();
        let err = import_base_map(&scratch.at("gone.png"), &scratch.at("out.png")).unwrap_err();
        assert!(err.contains("gone.png"), "{err}");
    }

    /// A half-written base map in `layers/` would be a broken page that nothing
    /// reports, so the destination only ever appears whole.
    #[test]
    fn a_failed_decode_leaves_nothing_where_the_base_map_goes() {
        let scratch = Scratch::new();
        let mut jpeg = source_jpeg(64, 64, &pixels(64, 64, false));
        // Keep the markers that say "complete" and ruin the scan data between
        // them, so the file gets past validation and dies in the decoder.
        for byte in jpeg.iter_mut().skip(600).take(400) {
            *byte = 0xff;
        }
        let source = scratch.holding("in.jpg", &jpeg);
        let dest = scratch.at("out.png");

        assert!(import_base_map(&source, &dest).is_err());
        assert!(!dest.exists(), "a failed decode left a file behind");
    }
}
