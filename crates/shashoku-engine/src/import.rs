//! Turning a source image into a page's base map.
//!
//! File in, file out — the pixels never reach JavaScript. The source's bytes
//! are carried across as they are, so a page is made in the time a copy takes
//! rather than the time a decode and a lossless re-encode take.

use std::fs;
use std::path::{Path, PathBuf};

use image::ImageDecoder;
use image::codecs::jpeg::JpegDecoder;
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::metadata::Orientation;

/// What a page learns about itself from the image it was created with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BaseMap {
    pub width: u32,
    pub height: u32,
    pub extension: &'static str,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Webp,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
            Format::Webp => "webp",
        }
    }
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

/// The size Chromium will draw the image at. It applies a source's EXIF
/// orientation when it decodes, so a quarter turn swaps the two sides.
fn drawn_size(mut decoder: impl ImageDecoder) -> (u32, u32) {
    let (width, height) = decoder.dimensions();
    match decoder.orientation() {
        Ok(
            Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH,
        ) => (height, width),
        _ => (width, height),
    }
}

/// Reads the header alone; the pixels are left for Chromium to decode.
fn size_of(format: Format, bytes: &[u8]) -> Result<(u32, u32), String> {
    let read = std::io::Cursor::new(bytes);
    Ok(match format {
        Format::Png => drawn_size(PngDecoder::new(read).map_err(|e| format!("png: {e}"))?),
        Format::Jpeg => drawn_size(JpegDecoder::new(read).map_err(|e| format!("jpeg: {e}"))?),
        Format::Webp => drawn_size(WebPDecoder::new(read).map_err(|e| format!("webp: {e}"))?),
    })
}

/// Beside the destination rather than in the system temp directory, so the
/// rename that follows stays within one filesystem and is therefore atomic.
fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}

fn write_whole(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    // Through a neighbour and a rename: a base map that appeared half-written
    // would be a broken page with nothing to report it.
    let part = part_path(dest);
    fs::write(&part, bytes).map_err(|e| format!("write {}: {e}", part.display()))?;
    fs::rename(&part, dest).map_err(|e| {
        let _ = fs::remove_file(&part);
        format!("rename onto {}: {e}", dest.display())
    })
}

/// Reads `source`, writes its bytes to `dest_stem` plus the extension its
/// format takes, and reports the size the page therefore has and that
/// extension.
pub fn import_base_map(source: &Path, dest_stem: &Path) -> Result<BaseMap, String> {
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

    let (width, height) = size_of(format, &bytes)?;
    let extension = format.extension();
    let mut dest = dest_stem.as_os_str().to_os_string();
    dest.push(".");
    dest.push(extension);
    write_whole(Path::new(&dest), &bytes)?;
    Ok(BaseMap {
        width,
        height,
        extension,
    })
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

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    fn pixels(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                rgba.extend_from_slice(&[
                    (x * 7) as u8,
                    (y * 11) as u8,
                    ((x ^ y) & 0xff) as u8,
                    255,
                ]);
            }
        }
        rgba
    }

    fn source_png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(
                &pixels(width, height),
                width,
                height,
                ExtendedColorType::Rgba8,
            )
            .unwrap();
        out
    }

    fn source_jpeg(width: u32, height: u32) -> Vec<u8> {
        let rgb: Vec<u8> = pixels(width, height)
            .chunks_exact(4)
            .flat_map(|px| [px[0], px[1], px[2]])
            .collect();
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95)
            .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    fn source_webp(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut out)
            .write_image(
                &pixels(width, height),
                width,
                height,
                ExtendedColorType::Rgba8,
            )
            .unwrap();
        out
    }

    /// An APP1 segment holding a one-entry EXIF IFD with the orientation tag.
    fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II*\0");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&orientation.to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        tiff.extend_from_slice(&0u32.to_le_bytes());
        let payload_len = 2 + 6 + tiff.len();
        let mut out = Vec::with_capacity(jpeg.len() + payload_len + 2);
        out.extend_from_slice(&jpeg[..2]);
        out.extend_from_slice(&[0xff, 0xe1]);
        out.extend_from_slice(&(payload_len as u16).to_be_bytes());
        out.extend_from_slice(b"Exif\0\0");
        out.extend_from_slice(&tiff);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    // ── what comes out ──────────────────────────────────────────────────────

    #[test]
    fn each_format_arrives_byte_for_byte_under_its_own_extension() {
        for (name, bytes, extension, size) in [
            ("in.png", source_png(16, 9), "png", (16, 9)),
            ("in.jpg", source_jpeg(24, 12), "jpg", (24, 12)),
            ("in.webp", source_webp(20, 10), "webp", (20, 10)),
        ] {
            let scratch = Scratch::new();
            let source = scratch.holding(name, &bytes);

            let map = import_base_map(&source, &scratch.at("out")).unwrap();

            assert_eq!(
                map,
                BaseMap {
                    width: size.0,
                    height: size.1,
                    extension
                }
            );
            assert_eq!(
                fs::read(scratch.at(&format!("out.{extension}"))).unwrap(),
                bytes
            );
        }
    }

    #[test]
    fn a_quarter_turn_in_the_exif_swaps_the_size_the_page_takes() {
        let scratch = Scratch::new();
        let source = scratch.holding("in.jpg", &with_orientation(&source_jpeg(24, 12), 6));

        let map = import_base_map(&source, &scratch.at("out")).unwrap();

        assert_eq!((map.width, map.height), (12, 24));
    }

    // ── what gets refused ───────────────────────────────────────────────────

    #[test]
    fn a_jpeg_cut_short_of_its_end_marker_is_refused() {
        let scratch = Scratch::new();
        let whole = source_jpeg(64, 64);
        let source = scratch.holding("in.jpg", &whole[..whole.len() * 2 / 3]);

        let err = import_base_map(&source, &scratch.at("out")).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert_eq!(
            scratch.names(),
            ["in.jpg"],
            "a refused source left a file behind"
        );
    }

    #[test]
    fn a_png_cut_short_of_its_end_marker_is_refused() {
        let scratch = Scratch::new();
        let whole = source_png(64, 64);
        let source = scratch.holding("in.png", &whole[..whole.len() - 4]);

        let err = import_base_map(&source, &scratch.at("out")).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert_eq!(
            scratch.names(),
            ["in.png"],
            "a refused source left a file behind"
        );
    }

    #[test]
    fn a_webp_shorter_than_its_header_promises_is_refused() {
        let scratch = Scratch::new();
        let whole = source_webp(64, 64);
        let source = scratch.holding("in.webp", &whole[..whole.len() - 32]);

        let err = import_base_map(&source, &scratch.at("out")).unwrap_err();

        assert!(err.contains("still being written"), "{err}");
        assert_eq!(
            scratch.names(),
            ["in.webp"],
            "a refused source left a file behind"
        );
    }

    #[test]
    fn a_header_that_does_not_parse_is_refused() {
        let scratch = Scratch::new();
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"not a header at all");
        bytes.extend_from_slice(PNG_END);
        let source = scratch.holding("in.png", &bytes);

        assert!(import_base_map(&source, &scratch.at("out")).is_err());
        assert_eq!(
            scratch.names(),
            ["in.png"],
            "a refused source left a file behind"
        );
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

        let err = import_base_map(&path, &scratch.at("out")).unwrap_err();

        assert!(err.contains("not on this machine"), "{err}");
    }

    #[test]
    fn a_format_nothing_here_reads_is_refused() {
        let scratch = Scratch::new();
        let source = scratch.holding("in.tif", b"II*\0\x08\0\0\0not really a tiff either");

        let err = import_base_map(&source, &scratch.at("out")).unwrap_err();

        assert!(err.contains("PNG, JPEG or WebP"), "{err}");
    }

    #[test]
    fn a_source_that_is_not_there_is_refused() {
        let scratch = Scratch::new();
        let err = import_base_map(&scratch.at("gone.png"), &scratch.at("out")).unwrap_err();
        assert!(err.contains("gone.png"), "{err}");
    }
}
