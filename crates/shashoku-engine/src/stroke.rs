//! Stroke as a band on the distance field of the filled coverage.
//!
//! A Photoshop layer-style stroke is a band grown from the *content's* edge,
//! not an offset of the vector path — its interface offers a position and a
//! width and no joins or caps, which is the tell. Building it from the
//! rasterized coverage rather than from the outline is therefore both closer
//! to the semantics and immune to what a path stroker struggles with:
//! contours that overlap, that are smaller than the pen, or that a font drew
//! in an inconsistent direction.

/// Farther than any distance a real bitmap can produce.
const FAR: f32 = 1.0e9;

/// Distance from a pixel's centre to the straight edge that would cover `a` of
/// it, given the direction coverage grows in. Positive when the centre is on
/// the empty side.
///
/// Gustavson & Strand's edge estimate: the exact geometry of a half plane
/// cutting the unit square, which is what an area-sampled edge pixel is.
/// Everything is symmetric under sign and transposition, so the direction is
/// folded into one octant and only three cases remain — the edge crosses two
/// opposite sides, or it cuts one corner off either end.
fn edge_offset(gx: f32, gy: f32, a: f32) -> f32 {
    if gx == 0.0 || gy == 0.0 {
        return 0.5 - a;
    }
    let length = (gx * gx + gy * gy).sqrt();
    let (mut gx, mut gy) = (gx.abs() / length, gy.abs() / length);
    if gx < gy {
        std::mem::swap(&mut gx, &mut gy);
    }
    let corner = 0.5 * gy / gx;
    if a < corner {
        0.5 * (gx + gy) - (2.0 * gx * gy * a).sqrt()
    } else if a < 1.0 - corner {
        (0.5 - a) * gx
    } else {
        -0.5 * (gx + gy) + (2.0 * gx * gy * (1.0 - a)).sqrt()
    }
}

/// Sobel with the diagonal taps weighted by √2, so the response is isotropic.
fn gradient(coverage: &[f32], width: usize, height: usize, x: usize, y: usize) -> (f32, f32) {
    let at = |dx: isize, dy: isize| -> f32 {
        let sx = (x as isize + dx).clamp(0, width as isize - 1) as usize;
        let sy = (y as isize + dy).clamp(0, height as isize - 1) as usize;
        coverage[sy * width + sx]
    };
    const D: f32 = std::f32::consts::SQRT_2;
    (
        -at(-1, -1) - D * at(-1, 0) - at(-1, 1) + at(1, -1) + D * at(1, 0) + at(1, 1),
        -at(-1, -1) - D * at(0, -1) - at(1, -1) + at(-1, 1) + D * at(0, 1) + at(1, 1),
    )
}

/// Signed distance in pixels from every pixel's centre to the edge of the
/// covered region, negative inside. Pixels no boundary reaches keep ±[`FAR`].
///
/// The transform carries the offset *vector* rather than a scalar, because the
/// sub-pixel offsets that seed it have a direction: propagating `|v|` alone
/// would round every seed's fractional part away on the first step.
pub fn signed_distance_field(coverage: &[f32], width: usize, height: usize) -> Vec<f32> {
    let n = width * height;
    let mut vx = vec![FAR; n];
    let mut vy = vec![FAR; n];

    let saturated = |i: usize| coverage[i] <= 0.0 || coverage[i] >= 1.0;
    let inside = |i: usize| coverage[i] >= 0.5;

    // An edge that happens to fall on a pixel boundary — an upright stem at a
    // whole coordinate, say — leaves no partly covered pixel anywhere along
    // it, and seeding on partial coverage alone would miss the whole edge and
    // drop the stroke. Both sides of such a pair are half a pixel from it.
    // Only ever a fallback: where a partly covered pixel exists it carries the
    // sub-pixel offset, and a flat 0.5 next to it would undercut the truth.
    let crisp_edge = |x: usize, y: usize| {
        let here = y * width + x;
        if !saturated(here) {
            return false;
        }
        let mut neighbours = [None; 4];
        if x > 0 {
            neighbours[0] = Some(here - 1);
        }
        if x + 1 < width {
            neighbours[1] = Some(here + 1);
        }
        if y > 0 {
            neighbours[2] = Some(here - width);
        }
        if y + 1 < height {
            neighbours[3] = Some(here + width);
        }
        neighbours
            .iter()
            .flatten()
            .any(|&n| saturated(n) && inside(n) != inside(here))
    };

    for y in 0..height {
        for x in 0..width {
            let a = coverage[y * width + x];
            if (a <= 0.0 || a >= 1.0) && !crisp_edge(x, y) {
                continue;
            }
            let (gx, gy) = gradient(coverage, width, height, x, y);
            let offset = edge_offset(gx, gy, a);
            let length = (gx * gx + gy * gy).sqrt();
            // A flat neighbourhood leaves no direction to travel in; the
            // magnitude is still the best estimate available.
            let (nx, ny) = if length > 0.0 {
                (gx / length, gy / length)
            } else {
                (1.0, 0.0)
            };
            vx[y * width + x] = offset * nx;
            vy[y * width + x] = offset * ny;
        }
    }

    propagate(&mut vx, &mut vy, width, height);

    (0..n)
        .map(|i| {
            let d = (vx[i] * vx[i] + vy[i] * vy[i]).sqrt();
            if coverage[i] >= 0.5 { -d } else { d }
        })
        .collect()
}

/// Two sweeps of the 8-point sequential distance transform. Each pixel takes
/// the shortest of its own vector and its already-swept neighbours' vectors
/// walked back by one step.
fn propagate(vx: &mut [f32], vy: &mut [f32], width: usize, height: usize) {
    let w = width as isize;
    let h = height as isize;

    let relax = |vx: &mut [f32], vy: &mut [f32], x: isize, y: isize, dx: isize, dy: isize| {
        let (sx, sy) = (x + dx, y + dy);
        if sx < 0 || sy < 0 || sx >= w || sy >= h {
            return;
        }
        let from = (sy * w + sx) as usize;
        let here = (y * w + x) as usize;
        // The neighbour sits one step away, so the boundary point it found is
        // that step further from here than it is from there.
        let cx = vx[from] + dx as f32;
        let cy = vy[from] + dy as f32;
        if cx * cx + cy * cy < vx[here] * vx[here] + vy[here] * vy[here] {
            vx[here] = cx;
            vy[here] = cy;
        }
    };

    // Each pass needs a return sweep along the row. Without it nothing can
    // travel up and right, or down and left, in one go — the downward pass
    // only ever carries a value rightward, and a boundary lying below and to
    // the left of a pixel then never reaches it.
    for y in 0..h {
        for x in 0..w {
            relax(vx, vy, x, y, -1, 0);
            relax(vx, vy, x, y, 0, -1);
            relax(vx, vy, x, y, -1, -1);
            relax(vx, vy, x, y, 1, -1);
        }
        for x in (0..w).rev() {
            relax(vx, vy, x, y, 1, 0);
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            relax(vx, vy, x, y, 1, 0);
            relax(vx, vy, x, y, 0, 1);
            relax(vx, vy, x, y, 1, 1);
            relax(vx, vy, x, y, -1, 1);
        }
        for x in 0..w {
            relax(vx, vy, x, y, -1, 0);
        }
    }
}

/// Antialiased coverage of the region grown by `offset` from the shape, read
/// off the distance field. A unit-wide ramp centred on the offset boundary is
/// what an area-sampled straight edge produces.
pub fn coverage_at(distance: f32, offset: f32) -> f32 {
    (0.5 + offset - distance).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Area-sampled coverage of a disc, to a straight-edge approximation.
    fn disc(width: usize, height: usize, cx: f32, cy: f32, r: f32) -> Vec<f32> {
        let mut out = vec![0.0; width * height];
        for y in 0..height {
            for x in 0..width {
                let dx = x as f32 + 0.5 - cx;
                let dy = y as f32 + 0.5 - cy;
                let d = (dx * dx + dy * dy).sqrt() - r;
                out[y * width + x] = (0.5 - d).clamp(0.0, 1.0);
            }
        }
        out
    }

    #[test]
    fn distance_tracks_a_known_circle_to_a_fraction_of_a_pixel() {
        let (w, h, r) = (96usize, 96usize, 24.0f32);
        let field = signed_distance_field(&disc(w, h, 48.0, 48.0, r), w, h);

        let mut worst: f32 = 0.0;
        for y in 0..h {
            for x in 0..w {
                let dx = x as f32 + 0.5 - 48.0;
                let dy = y as f32 + 0.5 - 48.0;
                let truth = (dx * dx + dy * dy).sqrt() - r;
                // Only where a stroke would ever read it; far away the
                // transform is allowed to drift.
                if truth.abs() > 16.0 {
                    continue;
                }
                worst = worst.max((field[y * w + x] - truth).abs());
            }
        }
        assert!(worst < 0.35, "worst error {worst}px");
    }

    #[test]
    fn a_blank_coverage_has_no_boundary_to_measure() {
        let field = signed_distance_field(&vec![0.0; 64], 8, 8);
        assert!(field.iter().all(|&d| d > 1.0e6));
    }

    #[test]
    fn an_edge_on_a_pixel_boundary_is_still_found() {
        // Nothing is partly covered anywhere, which is exactly what an upright
        // stem at a whole coordinate produces.
        let (w, h) = (8usize, 3usize);
        let mut coverage = vec![0.0; w * h];
        for y in 0..h {
            for x in 4..w {
                coverage[y * w + x] = 1.0;
            }
        }
        let field = signed_distance_field(&coverage, w, h);
        assert!((field[w + 3] - 0.5).abs() < 0.01, "{}", field[w + 3]);
        assert!((field[w + 4] + 0.5).abs() < 0.01, "{}", field[w + 4]);
        assert!((field[w + 1] - 2.5).abs() < 0.01, "{}", field[w + 1]);
    }

    #[test]
    fn an_edge_pixel_reports_its_own_sub_pixel_offset() {
        // A vertical edge cutting the middle column at 30% coverage sits
        // 0.2px past that column's centre.
        let (w, h) = (5usize, 3usize);
        let mut coverage = vec![0.0; w * h];
        for y in 0..h {
            coverage[y * w + 3] = 0.3;
            coverage[y * w + 4] = 1.0;
        }
        let field = signed_distance_field(&coverage, w, h);
        assert!(
            (field[1 * w + 3] - 0.2).abs() < 0.05,
            "{}",
            field[1 * w + 3]
        );
    }
}
