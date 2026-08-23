//! What a node carries on top of itself, composed onto a picture.
//!
//! The text path builds its band from the rasterized coverage of an outline
//! (see the stroke module); this builds the same band from a layer's own alpha.
//! One distance field, one pair of offsets, one composition — so a layer's
//! stroke and a letter's are the same effect and not two that happen to agree.
//!
//! Nothing here writes to a layer. A stroke is composited, so the pixels it is
//! grown from are the ones the layer had before and the ones it still has after.

use crate::render::{Rgba, StrokeSpec, band_offsets};
use crate::stroke::{coverage_at, signed_distance_field};

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

/// One stroke composed onto straight RGBA, the content over the band.
///
/// The band is the *whole* region grown to the outer offset rather than an
/// annulus, and the content sits on top of it. Subtracting instead would seam:
/// at a pixel the content half covers, an annulus carries the other half and the
/// two compose to three quarters, where laying a full band under a half-covered
/// pixel composes to one — which is what an edge between two opaque things is.
///
/// An inner offset that reaches inside erodes the content by exactly as much,
/// which is how Center and Inside get to paint over it. `min` rather than a
/// ratio: eroding can only ever take alpha away, and where the field says "well
/// inside" the content's own alpha is left untouched rather than round-tripped
/// through a reconstruction of itself.
fn compose_stroke(rgba: &[u8], width: usize, height: usize, spec: &StrokeSpec) -> Vec<u8> {
    let count = width * height;
    let coverage: Vec<f32> = (0..count)
        .map(|i| rgba[i * 4 + 3] as f32 / 255.0)
        .collect();
    let field = signed_distance_field(&coverage, width, height);
    let (outer, inner) = band_offsets(spec.position, spec.width);
    let (sr, sg, sb, sa) = unit(spec.color);

    let mut out = vec![0u8; count * 4];
    for i in 0..count {
        // The layer's own alpha beats anything read back off the field, so it
        // stands wherever the boundary asked for is the content's own — the same
        // rule the text path's `layer` helper follows.
        let f = if inner == 0.0 {
            coverage[i]
        } else {
            coverage[i].min(coverage_at(field[i], inner))
        };
        let s = coverage_at(field[i], outer) * sa;
        let alpha = f + s * (1.0 - f);
        if alpha <= 0.0 {
            continue;
        }
        let mix = |above: f32, below: f32| (above * f + below * s * (1.0 - f)) / alpha;
        out[i * 4] = to_u8(mix(rgba[i * 4] as f32 / 255.0, sr));
        out[i * 4 + 1] = to_u8(mix(rgba[i * 4 + 1] as f32 / 255.0, sg));
        out[i * 4 + 2] = to_u8(mix(rgba[i * 4 + 2] as f32 / 255.0, sb));
        out[i * 4 + 3] = to_u8(alpha);
    }
    out
}

/// A picture with its node's effects composed onto it, straight RGBA in and out.
///
/// Applied in list order, each one grown from what the ones before it left. Two
/// strokes therefore come out as concentric bands rather than as one hiding the
/// other, and which is outside follows from where it sits in the list.
///
/// The caller sizes the buffer. A band reaches past the content it grew from, so
/// a region no wider than the content clips it — the margin is the caller's to
/// leave because only the caller knows what the content is standing on.
pub fn stroked(rgba: &[u8], width: usize, height: usize, specs: &[StrokeSpec]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for spec in specs {
        // Nothing to grow and nothing to grow it in: a width of zero has no band
        // and a fully transparent colour paints none, and the field costs the
        // whole region either way.
        if spec.width <= 0.0 || spec.color.3 == 0 {
            continue;
        }
        out = compose_stroke(&out, width, height, spec);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::StrokePosition;

    const W: usize = 32;
    const H: usize = 32;

    const RED: Rgba = Rgba(255, 0, 0, 255);
    const BLUE: Rgba = Rgba(0, 0, 255, 255);

    fn spec(width: f32, position: StrokePosition, color: Rgba) -> StrokeSpec {
        StrokeSpec {
            width,
            color,
            position,
        }
    }

    /// An opaque red square, `inset` pixels in from every edge.
    fn square(inset: usize) -> Vec<u8> {
        let mut out = vec![0u8; W * H * 4];
        for y in inset..H - inset {
            for x in inset..W - inset {
                let i = (y * W + x) * 4;
                out[i] = 255;
                out[i + 3] = 255;
            }
        }
        out
    }

    fn at(rgba: &[u8], x: usize, y: usize) -> (u8, u8, u8, u8) {
        let i = (y * W + x) * 4;
        (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])
    }

    #[test]
    fn an_outside_stroke_lands_beyond_the_content_and_leaves_it_alone() {
        let out = stroked(&square(8), W, H, &[spec(3.0, StrokePosition::Outside, BLUE)]);

        // Two past the edge is band, two inside it is still the content's own.
        assert_eq!(at(&out, 6, 16), (0, 0, 255, 255));
        assert_eq!(at(&out, 10, 16), (255, 0, 0, 255));
        // Four past the edge is beyond a three-wide band.
        assert_eq!(at(&out, 4, 16).3, 0);
    }

    #[test]
    fn an_inside_stroke_stays_within_the_content_and_never_reaches_past_it() {
        let out = stroked(&square(8), W, H, &[spec(3.0, StrokePosition::Inside, BLUE)]);

        assert_eq!(at(&out, 9, 16), (0, 0, 255, 255));
        assert_eq!(at(&out, 13, 16), (255, 0, 0, 255));
        // Nothing outside: an inside stroke cannot grow the content's footprint.
        assert_eq!(at(&out, 7, 16).3, 0);
    }

    #[test]
    fn a_centre_stroke_straddles_the_edge() {
        let out = stroked(&square(8), W, H, &[spec(4.0, StrokePosition::Center, BLUE)]);

        assert_eq!(at(&out, 7, 16), (0, 0, 255, 255));
        assert_eq!(at(&out, 9, 16), (0, 0, 255, 255));
        assert_eq!(at(&out, 12, 16), (255, 0, 0, 255));
        assert_eq!(at(&out, 5, 16).3, 0);
    }

    /// The seam an annulus would leave: where the content half covers a pixel,
    /// the band under it has to carry the other half rather than share it.
    #[test]
    fn a_soft_edge_composes_to_full_coverage_rather_than_to_a_notch() {
        let mut content = square(8);
        for y in 0..H {
            let i = (y * W + 8) * 4;
            content[i + 3] = 128;
        }

        let out = stroked(&content, W, H, &[spec(3.0, StrokePosition::Outside, BLUE)]);

        assert_eq!(at(&out, 8, 16).3, 255);
    }

    /// Coverage, not a binary mask: a rim that fades produces a band that fades
    /// with it, one step per level rather than one step for the whole rim.
    #[test]
    fn a_fading_rim_grows_a_band_that_moves_with_it() {
        let reach = |rim: u8| {
            let mut content = vec![0u8; W * H * 4];
            for y in 12..20 {
                for x in 12..20 {
                    content[(y * W + x) * 4 + 3] = 255;
                }
            }
            for y in 12..20 {
                content[(y * W + 12) * 4 + 3] = rim;
            }
            let out = stroked(&content, W, H, &[spec(4.0, StrokePosition::Outside, BLUE)]);
            (0..12)
                .map(|x| at(&out, x, 16).3 as u32)
                .sum::<u32>()
        };

        // A rim that covers more of its pixel puts the edge further out, and the
        // band grown from it reaches further out too — by a fraction of a pixel,
        // which only a sum over the band can see.
        assert!(reach(255) > reach(128), "{} vs {}", reach(255), reach(128));
        assert!(reach(128) > reach(32), "{} vs {}", reach(128), reach(32));
    }

    #[test]
    fn nothing_to_grow_comes_back_as_it_went_in() {
        let blank = vec![0u8; W * H * 4];
        assert_eq!(
            stroked(&blank, W, H, &[spec(3.0, StrokePosition::Outside, BLUE)]),
            blank
        );
    }

    #[test]
    fn no_effects_is_the_picture_itself() {
        let content = square(8);
        assert_eq!(stroked(&content, W, H, &[]), content);
    }

    /// Determinate and in list order: the second grows from what the first left,
    /// so it wraps the first rather than replacing it.
    #[test]
    fn two_strokes_stack_outward_in_the_order_they_are_listed() {
        let out = stroked(
            &square(12),
            W,
            H,
            &[
                spec(2.0, StrokePosition::Outside, BLUE),
                spec(2.0, StrokePosition::Outside, RED),
            ],
        );

        assert_eq!(at(&out, 16, 16), (255, 0, 0, 255));
        assert_eq!(at(&out, 11, 16), (0, 0, 255, 255));
        assert_eq!(at(&out, 9, 16), (255, 0, 0, 255));
        assert_eq!(at(&out, 7, 16).3, 0);

        let swapped = stroked(
            &square(12),
            W,
            H,
            &[
                spec(2.0, StrokePosition::Outside, RED),
                spec(2.0, StrokePosition::Outside, BLUE),
            ],
        );
        assert_ne!(at(&out, 11, 16), at(&swapped, 11, 16));
    }
}
