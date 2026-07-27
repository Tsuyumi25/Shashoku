//! Delivery encoding.
//!
//! Compositing happens on a canvas in the renderer, so a finished page arrives
//! here as straight RGBA and leaves as file bytes. Nothing in this module
//! decodes: the only image it ever sees is one the application just drew.
//!
//! This exists at all because the canvas can only write truecolour PNG, JPEG
//! and lossless WebP. Palettes, 1-bit and a quality search towards a byte
//! ceiling all need an encoder we can steer.

use color_quant::NeuQuant;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ColorType, ExtendedColorType, ImageEncoder};
use png::{BitDepth, ColorType as PngColorType, Encoder as PngEncoder};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Png,
    Png8,
    Jpeg,
    Webp,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    Color,
    Grayscale,
    Bilevel,
}

pub struct EncodeSpec {
    pub format: Format,
    pub color_mode: ColorMode,
    /// Ceiling in bytes. Only honoured where there is something to turn.
    pub max_bytes: Option<usize>,
    /// Where a JPEG quality search starts, 1..=100.
    pub quality: u8,
}

/// A page is a delivery, and a delivery is opaque. Flattening onto white also
/// takes the alpha channel out of every path below, which is what lets the
/// palette and 1-bit writers work on three bytes per pixel.
fn flatten_onto_white(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        let a = px[3] as u32;
        if a == 255 {
            rgb.extend_from_slice(&px[..3]);
            continue;
        }
        for &channel in px.iter().take(3) {
            let over = channel as u32 * a + 255 * (255 - a);
            rgb.push((over / 255) as u8);
        }
    }
    rgb
}

/// Rec. 601 luma, which is what every image tool means by "grayscale" and what
/// a reader comparing this against another export will have in front of them.
fn to_luma(rgb: &[u8]) -> Vec<u8> {
    rgb.chunks_exact(3)
        .map(|px| {
            let y = 0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32;
            y.round().clamp(0.0, 255.0) as u8
        })
        .collect()
}

/// Plain threshold rather than error diffusion. Screentone is already a
/// halftone pattern, and diffusing error across one turns a clean dot grid
/// into noise; line art thresholds cleanly on its own.
fn to_bilevel_rows(luma: &[u8], width: u32, height: u32) -> Vec<u8> {
    let row_bytes = width.div_ceil(8) as usize;
    let mut out = vec![0u8; row_bytes * height as usize];
    for y in 0..height as usize {
        for x in 0..width as usize {
            // PNG bilevel is grayscale, so a set bit is white.
            if luma[y * width as usize + x] >= 128 {
                out[y * row_bytes + x / 8] |= 0x80 >> (x % 8);
            }
        }
    }
    out
}

fn png_bytes(
    width: u32,
    height: u32,
    color: PngColorType,
    depth: BitDepth,
    palette: Option<Vec<u8>>,
    data: &[u8],
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = PngEncoder::new(&mut out, width, height);
        encoder.set_color(color);
        encoder.set_depth(depth);
        if let Some(palette) = palette {
            encoder.set_palette(palette);
        }
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png header: {e}"))?;
        writer
            .write_image_data(data)
            .map_err(|e| format!("png data: {e}"))?;
        writer.finish().map_err(|e| format!("png finish: {e}"))?;
    }
    Ok(out)
}

/// NeuQuant wants RGBA, and the palette it returns is RGBA too; PNG's PLTE is
/// three bytes per entry and the pages here are opaque, so the alpha is
/// dropped on both sides rather than carried as a tRNS chunk of 255s.
fn quantize(rgb: &[u8], colors: usize) -> (Vec<u8>, Vec<u8>) {
    let rgba: Vec<u8> = rgb
        .chunks_exact(3)
        .flat_map(|px| [px[0], px[1], px[2], 255])
        .collect();
    // Sample factor 10 reads every tenth pixel to train on. A page is millions
    // of pixels of mostly one colour; training on all of them costs seconds and
    // moves the palette nowhere.
    let quant = NeuQuant::new(10, colors, &rgba);
    let indexes = rgba
        .chunks_exact(4)
        .map(|px| quant.index_of(px) as u8)
        .collect();
    let palette = quant
        .color_map_rgba()
        .chunks_exact(4)
        .flat_map(|c| [c[0], c[1], c[2]])
        .collect();
    (indexes, palette)
}

fn encode_jpeg(rgb: &[u8], width: u32, height: u32, gray: bool, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut out, quality);
    let (data, color) = if gray {
        (to_luma(rgb), ExtendedColorType::L8)
    } else {
        (rgb.to_vec(), ExtendedColorType::Rgb8)
    };
    encoder
        .write_image(&data, width, height, color)
        .map_err(|e| format!("jpeg: {e}"))?;
    Ok(out)
}

fn encode_webp(rgb: &[u8], width: u32, height: u32, gray: bool) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    // Lossless is all this encoder does, so grayscale is written as RGB with
    // three equal channels — WebP has no grayscale form of its own, and the
    // compressor collapses the redundancy anyway.
    let data = if gray {
        to_luma(rgb).iter().flat_map(|&y| [y, y, y]).collect()
    } else {
        rgb.to_vec()
    };
    WebPEncoder::new_lossless(&mut out)
        .encode(&data, width, height, ColorType::Rgb8.into())
        .map_err(|e| format!("webp: {e}"))?;
    Ok(out)
}

fn encode_png(rgb: &[u8], width: u32, height: u32, mode: ColorMode) -> Result<Vec<u8>, String> {
    match mode {
        ColorMode::Color => png_bytes(width, height, PngColorType::Rgb, BitDepth::Eight, None, rgb),
        ColorMode::Grayscale => png_bytes(
            width,
            height,
            PngColorType::Grayscale,
            BitDepth::Eight,
            None,
            &to_luma(rgb),
        ),
        ColorMode::Bilevel => png_bytes(
            width,
            height,
            PngColorType::Grayscale,
            BitDepth::One,
            None,
            &to_bilevel_rows(&to_luma(rgb), width, height),
        ),
    }
}

fn encode_png8(
    rgb: &[u8],
    width: u32,
    height: u32,
    mode: ColorMode,
    colors: usize,
) -> Result<Vec<u8>, String> {
    if mode == ColorMode::Grayscale {
        // A grayscale palette is a ramp, so the levels are the palette and
        // there is nothing for the quantizer to learn.
        let levels = colors.max(2);
        let luma = to_luma(rgb);
        let step = 255.0 / (levels - 1) as f32;
        let palette = (0..levels)
            .flat_map(|i| {
                let v = (i as f32 * step).round() as u8;
                [v, v, v]
            })
            .collect();
        let indexes: Vec<u8> = luma
            .iter()
            .map(|&y| ((y as f32 / step).round() as usize).min(levels - 1) as u8)
            .collect();
        return png_bytes(
            width,
            height,
            PngColorType::Indexed,
            BitDepth::Eight,
            Some(palette),
            &indexes,
        );
    }
    let (indexes, palette) = quantize(rgb, colors.clamp(2, 256));
    png_bytes(
        width,
        height,
        PngColorType::Indexed,
        BitDepth::Eight,
        Some(palette),
        &indexes,
    )
}

/// Steps a quality search walks. Coarse on purpose: each step is a full
/// encode of a full page, and the difference between adjacent qualities is
/// below what anyone looking at the result can see.
const JPEG_LADDER: [u8; 8] = [95, 90, 85, 80, 72, 64, 55, 45];
const PALETTE_LADDER: [usize; 5] = [256, 128, 64, 32, 16];

pub fn encode(rgba: &[u8], width: u32, height: u32, spec: &EncodeSpec) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(format!(
            "expected {expected} bytes of RGBA for {width}x{height}, got {}",
            rgba.len()
        ));
    }
    let rgb = flatten_onto_white(rgba);
    let gray = spec.color_mode == ColorMode::Grayscale;

    let first = match spec.format {
        Format::Png => return encode_png(&rgb, width, height, spec.color_mode),
        Format::Webp => return encode_webp(&rgb, width, height, gray),
        Format::Jpeg => encode_jpeg(&rgb, width, height, gray, spec.quality)?,
        Format::Png8 => encode_png8(&rgb, width, height, spec.color_mode, 256)?,
    };

    let Some(ceiling) = spec.max_bytes else {
        return Ok(first);
    };
    if first.len() <= ceiling {
        return Ok(first);
    }

    // Walk down until it fits, and hand back the smallest attempt when nothing
    // does. Reporting the miss is the caller's job: it knows which page this
    // was, and stopping a batch is its decision.
    let mut best = first;
    match spec.format {
        Format::Jpeg => {
            for quality in JPEG_LADDER {
                if quality >= spec.quality {
                    continue;
                }
                let attempt = encode_jpeg(&rgb, width, height, gray, quality)?;
                let fits = attempt.len() <= ceiling;
                if attempt.len() < best.len() {
                    best = attempt;
                }
                if fits {
                    break;
                }
            }
        }
        Format::Png8 => {
            for colors in PALETTE_LADDER.iter().skip(1) {
                let attempt = encode_png8(&rgb, width, height, spec.color_mode, *colors)?;
                let fits = attempt.len() <= ceiling;
                if attempt.len() < best.len() {
                    best = attempt;
                }
                if fits {
                    break;
                }
            }
        }
        _ => {}
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(format: Format, color_mode: ColorMode) -> EncodeSpec {
        EncodeSpec {
            format,
            color_mode,
            max_bytes: None,
            quality: 90,
        }
    }

    /// A gradient with a few saturated blocks: compressible enough that the
    /// ladders have somewhere to go, varied enough that a palette has to think.
    fn page(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                rgba.push((x * 255 / width.max(1)) as u8);
                rgba.push((y * 255 / height.max(1)) as u8);
                rgba.push(((x ^ y) & 0xff) as u8);
                rgba.push(255);
            }
        }
        rgba
    }

    #[test]
    fn rejects_a_buffer_that_is_not_the_size_it_claims() {
        let err = encode(&[0, 0, 0, 255], 2, 2, &spec(Format::Png, ColorMode::Color)).unwrap_err();
        assert!(err.contains("expected 16 bytes"), "{err}");
    }

    #[test]
    fn writes_a_png_signature() {
        let out = encode(&page(8, 8), 8, 8, &spec(Format::Png, ColorMode::Color)).unwrap();
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn writes_a_jpeg_marker() {
        let out = encode(&page(8, 8), 8, 8, &spec(Format::Jpeg, ColorMode::Color)).unwrap();
        assert_eq!(&out[..2], b"\xff\xd8");
    }

    #[test]
    fn writes_a_webp_container() {
        let out = encode(&page(8, 8), 8, 8, &spec(Format::Webp, ColorMode::Color)).unwrap();
        assert_eq!(&out[..4], b"RIFF");
        assert_eq!(&out[8..12], b"WEBP");
    }

    #[test]
    fn bilevel_packs_eight_pixels_to_a_byte() {
        let out = encode(&page(16, 4), 16, 4, &spec(Format::Png, ColorMode::Bilevel)).unwrap();
        let decoded = png::Decoder::new(std::io::Cursor::new(&out)).read_info().unwrap();
        assert_eq!(decoded.info().bit_depth, BitDepth::One);
        assert_eq!(decoded.info().color_type, PngColorType::Grayscale);
    }

    #[test]
    fn png8_carries_a_palette() {
        let out = encode(&page(32, 32), 32, 32, &spec(Format::Png8, ColorMode::Color)).unwrap();
        let decoded = png::Decoder::new(std::io::Cursor::new(&out)).read_info().unwrap();
        assert_eq!(decoded.info().color_type, PngColorType::Indexed);
        assert!(decoded.info().palette.is_some());
    }

    #[test]
    fn flattening_lays_transparency_onto_white() {
        // Half-transparent black over white is mid grey, not black.
        let rgb = flatten_onto_white(&[0, 0, 0, 128]);
        assert_eq!(rgb, vec![127, 127, 127]);
    }

    #[test]
    fn an_opaque_pixel_comes_through_untouched() {
        assert_eq!(flatten_onto_white(&[10, 20, 30, 255]), vec![10, 20, 30]);
    }

    #[test]
    fn a_ceiling_drives_jpeg_quality_down() {
        let pixels = page(64, 64);
        let loose = encode(&pixels, 64, 64, &spec(Format::Jpeg, ColorMode::Color)).unwrap();
        let tight = encode(
            &pixels,
            64,
            64,
            &EncodeSpec {
                max_bytes: Some(loose.len() / 2),
                ..spec(Format::Jpeg, ColorMode::Color)
            },
        )
        .unwrap();
        assert!(tight.len() < loose.len(), "{} vs {}", tight.len(), loose.len());
    }

    #[test]
    fn a_ceiling_nothing_can_meet_yields_the_smallest_attempt() {
        let pixels = page(64, 64);
        let out = encode(
            &pixels,
            64,
            64,
            &EncodeSpec {
                max_bytes: Some(1),
                ..spec(Format::Jpeg, ColorMode::Color)
            },
        )
        .unwrap();
        assert_eq!(&out[..2], b"\xff\xd8");
        assert!(out.len() > 1);
    }

    #[test]
    fn a_ceiling_shrinks_the_png8_palette() {
        let pixels = page(64, 64);
        let loose = encode(&pixels, 64, 64, &spec(Format::Png8, ColorMode::Color)).unwrap();
        let tight = encode(
            &pixels,
            64,
            64,
            &EncodeSpec {
                max_bytes: Some(loose.len() * 2 / 3),
                ..spec(Format::Png8, ColorMode::Color)
            },
        )
        .unwrap();
        assert!(tight.len() < loose.len(), "{} vs {}", tight.len(), loose.len());
    }
}
