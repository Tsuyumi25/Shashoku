//! Raster layers the engine has taken over, and the writes that reach them.
//!
//! A layer arrives whole, once, the first time it is edited, and leaves when the
//! page is turned. While it is held, the engine owns its pixels: every write is
//! a transaction against the tile grid, and what comes back is only the part
//! that changed.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use crate::tile::{Rgba8, TILE_SIZE, Tile, TileCoord, TileGrid, TileJournal, TileTransaction};

// ────────────────────────────────────────────────────────────────────────────
// Rectangles

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub const EMPTY: Rect = Rect {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    };

    pub fn is_empty(&self) -> bool {
        self.w <= 0 || self.h <= 0
    }

    pub(crate) fn right(&self) -> i32 {
        self.x + self.w
    }

    pub(crate) fn bottom(&self) -> i32 {
        self.y + self.h
    }

    /// An empty rectangle is the identity — a write that covered nothing must
    /// not drag a frame's corner to the origin.
    pub(crate) fn union(self, other: Rect) -> Rect {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        Rect {
            x,
            y,
            w: self.right().max(other.right()) - x,
            h: self.bottom().max(other.bottom()) - y,
        }
    }

    pub(crate) fn intersect(self, other: Rect) -> Rect {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        Rect {
            x,
            y,
            w: self.right().min(other.right()) - x,
            h: self.bottom().min(other.bottom()) - y,
        }
    }

    pub(crate) fn offset(self, dx: i32, dy: i32) -> Rect {
        Rect {
            x: self.x + dx,
            y: self.y + dy,
            ..self
        }
    }
}

/// The inclusive range of tiles a rectangle touches.
fn tile_span(rect: Rect) -> (i32, i32, i32, i32) {
    (
        rect.x.div_euclid(TILE_SIZE),
        rect.y.div_euclid(TILE_SIZE),
        (rect.x + rect.w - 1).div_euclid(TILE_SIZE),
        (rect.y + rect.h - 1).div_euclid(TILE_SIZE),
    )
}

fn tile_rect(coord: TileCoord) -> Rect {
    Rect {
        x: coord.tx * TILE_SIZE,
        y: coord.ty * TILE_SIZE,
        w: TILE_SIZE,
        h: TILE_SIZE,
    }
}

/// How far past what it has to cover a preview's frame is allowed to reach.
///
/// Slack is not waste here, it is the whole saving: moving that frame is what
/// makes a caller rebuild its picture of the layer, and rebuilding is by far the
/// most expensive thing a stroke can ask for. Room to grow into turns "moves on
/// every event" into "moves a handful of times a stroke".
///
/// GIMP spends 100 px on the same problem, on the layer itself, and offers it as
/// a setting. This is spent on a rectangle that dies with the stroke, so it can
/// afford to be more generous.
const PREVIEW_SLACK: i32 = 256;

/// Where a preview's frame stands once it has had to move to hold `covered`.
///
/// **Only when it has to.** A frame that grew while the coverage justifying it
/// stayed inside the committed one would be a frame the release then disagrees
/// with, and the caller rebuilds against the smaller answer and keeps only what
/// the write touched. Nothing else it draws survives that.
///
/// Once it does have to move, the slack goes on and the result is taken out to
/// the tile grid, where the work lands anyway.
fn with_slack(stood: Rect, covered: Rect) -> Rect {
    let wanted = stood.union(covered);
    if wanted == stood {
        return stood;
    }
    /*
     * Slack goes on the edges that actually moved, and nowhere else. Spending
     * it on all four every time compounds: a stroke down one diagonal moves the
     * right and bottom edges over and over, and paying the left and top each
     * time puts a frame around the layer that is several times the page.
     */
    let empty = stood.w <= 0 || stood.h <= 0;
    let grew = |moved: bool, edge: i32, by: i32| if empty || moved { edge + by } else { edge };
    let left = grew(wanted.x < stood.x, wanted.x, -PREVIEW_SLACK);
    let top = grew(wanted.y < stood.y, wanted.y, -PREVIEW_SLACK);
    let right = grew(
        wanted.x + wanted.w > stood.x + stood.w,
        wanted.x + wanted.w,
        PREVIEW_SLACK,
    );
    let bottom = grew(
        wanted.y + wanted.h > stood.y + stood.h,
        wanted.y + wanted.h,
        PREVIEW_SLACK,
    );
    let x0 = left.div_euclid(TILE_SIZE) * TILE_SIZE;
    let y0 = top.div_euclid(TILE_SIZE) * TILE_SIZE;
    let x1 = (right - 1).div_euclid(TILE_SIZE) * TILE_SIZE + TILE_SIZE;
    let y1 = (bottom - 1).div_euclid(TILE_SIZE) * TILE_SIZE + TILE_SIZE;
    // Never smaller than what stood there: the caller's picture covers it
    // already, and giving it back a shrunken frame is a rebuild for nothing.
    stood.union(Rect {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
    })
}

/// The tight box of everything a mask covers, in page pixels, or an empty
/// rectangle when it covers nothing.
///
/// The same question `paint_mask` answers on its way through, asked separately
/// because a preview has to know how far the frame would move before it can
/// decide how much of the layer to hand back — and that is before there is any
/// paint to look at.
fn covered_bounds(mask: &[u8], mask_frame: Rect) -> Rect {
    let mut x0 = mask_frame.w;
    let mut y0 = mask_frame.h;
    let mut x1 = -1;
    let mut y1 = -1;
    for row in 0..mask_frame.h {
        let line = row as usize * mask_frame.w as usize;
        for col in 0..mask_frame.w {
            if mask[line + col as usize] == 0 {
                continue;
            }
            if col < x0 {
                x0 = col;
            }
            if col > x1 {
                x1 = col;
            }
            if row < y0 {
                y0 = row;
            }
            y1 = row;
        }
    }
    if x1 < 0 {
        return Rect::EMPTY;
    }
    Rect {
        x: mask_frame.x + x0,
        y: mask_frame.y + y0,
        w: x1 - x0 + 1,
        h: y1 - y0 + 1,
    }
}

/// A mask has to describe exactly its frame. Checked in one place because the
/// committed write and the preview are the same call twice over, and a bound
/// enforced in only one of them is the one an out-of-range read gets through.
fn check_mask(mask: &[u8], mask_frame: Rect) -> Result<(), String> {
    let wanted = (mask_frame.w.max(0) as usize)
        .checked_mul(mask_frame.h.max(0) as usize)
        .ok_or_else(|| "mask is too large to describe".to_string())?;
    if mask.len() != wanted {
        return Err(format!(
            "mask of {}x{} needs {wanted} bytes, got {}",
            mask_frame.w,
            mask_frame.h,
            mask.len()
        ));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// Compositing

/// How a scratch layer lands on the layer under it.
///
/// The whole of the difference between painting and erasing. Neither has
/// anything of its own in the data model — both put coverage on the paper and
/// differ only here, which is what lets one transaction, one record and one
/// undo path serve both.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Blend {
    Over,
    /// `Over`, but the layer's own alpha is left exactly where it was.
    OverLocked,
    Erase,
}

/// Which way paint lands, which is the layer's own alpha lock and nothing else.
fn paint_blend(alpha_locked: bool) -> Blend {
    if alpha_locked {
        Blend::OverLocked
    } else {
        Blend::Over
    }
}

/// `src` over `dst`, both straight RGBA.
///
/// Kept in 255-scaled integers throughout rather than dividing as it goes: the
/// backdrop's contribution is a product of two eighth-bit numbers, and rounding
/// it before it is weighed is how a repeated composite drifts.
fn over(src: &[u8], dst: &mut [u8]) {
    let sa = src[3] as u32;
    if sa == 0 {
        return;
    }
    if sa == 255 {
        dst.copy_from_slice(src);
        return;
    }
    let inv = 255 - sa;
    let behind = dst[3] as u32 * inv;
    let alpha = sa * 255 + behind;
    if alpha == 0 {
        dst.fill(0);
        return;
    }
    for channel in 0..3 {
        let front = src[channel] as u32 * sa * 255;
        let back = dst[channel] as u32 * behind;
        dst[channel] = ((front + back + alpha / 2) / alpha) as u8;
    }
    dst[3] = ((alpha + 127) / 255) as u8;
}

/// `src` over `dst` with the layer's alpha lock on: the paint lands where there
/// is already coverage and nowhere else, and the alpha it landed on is put back.
///
/// Where the backdrop was transparent the result is too, and the tile's release
/// strips the colour that would otherwise be left hiding behind a zero alpha.
fn over_locked(src: &[u8], dst: &mut [u8]) {
    let kept = dst[3];
    over(src, dst);
    dst[3] = kept;
}

/// `src`'s coverage taken out of `dst`.
///
/// Always all the way through, never down to whatever is underneath: an eraser
/// that stopped at the layer below would be a second kind of transparency, and
/// there is only one.
///
/// The colour is left where the alpha survives. Under straight alpha the two are
/// independent, and a pixel taken to zero has its colour stripped when the tile
/// is released — which is the same rule every other write obeys.
fn punch(src: &[u8], dst: &mut [u8]) {
    let coverage = src[3] as u32;
    if coverage == 0 {
        return;
    }
    if coverage == 255 {
        dst.fill(0);
        return;
    }
    dst[3] = ((dst[3] as u32 * (255 - coverage) + 127) / 255) as u8;
}

// ────────────────────────────────────────────────────────────────────────────
// A held layer

/// One raster layer's pixels while the engine holds them.
pub struct RasterLayer {
    /// The page pixel that layer-local (0, 0) sits on. Fixed for as long as the
    /// layer is held: growing the frame moves `bounds` into the negative rather
    /// than moving this, which is what keeps every tile coordinate meaning the
    /// same thing for the whole session.
    anchor_x: i32,
    anchor_y: i32,
    /// The content's extent in layer-local pixels. Grows with writes and never
    /// shrinks — a frame larger than its content wastes a little disk, a frame
    /// smaller than its content loses pixels.
    bounds: Rect,
    grid: TileGrid<Rgba8>,
}

/// What the layer's frame is in page pixels, and what changed inside it.
pub struct Patch {
    pub frame: Rect,
    pub changed: Rect,
    pub rgba: Vec<u8>,
}

/// The same three things for a write that has not happened: where the frame
/// would stand, which part of the page the pixels describe, and the pixels.
pub struct Preview {
    pub frame: Rect,
    pub changed: Rect,
    pub rgba: Vec<u8>,
}

/// One write's worth of undo: the tiles it wrote over, and the frame it found.
///
/// Both halves swap, so applying this puts the layer back and applying it again
/// puts the write back. A frame is as much a part of a write as the pixels are —
/// a stroke reaching past the left edge changes x and w, and restoring only the
/// tiles would leave the layer standing in the wrong place.
pub struct LayerJournal {
    layer: String,
    tiles: TileJournal<Rgba8>,
    bounds: Rect,
}

impl RasterLayer {
    /// Takes a whole layer over. `frame` is where it sits on the page.
    pub fn take(rgba: &[u8], frame: Rect) -> Result<Self, String> {
        let wanted = (frame.w.max(0) as usize)
            .checked_mul(frame.h.max(0) as usize)
            .and_then(|px| px.checked_mul(4))
            .ok_or_else(|| "layer frame is too large to describe".to_string())?;
        if rgba.len() != wanted {
            return Err(format!(
                "layer of {}x{} needs {wanted} bytes, got {}",
                frame.w,
                frame.h,
                rgba.len()
            ));
        }
        let mut layer = Self {
            anchor_x: frame.x,
            anchor_y: frame.y,
            bounds: Rect {
                x: 0,
                y: 0,
                w: frame.w.max(0),
                h: frame.h.max(0),
            },
            grid: TileGrid::new(),
        };
        let at = Rect {
            x: 0,
            y: 0,
            ..layer.bounds
        };
        let mut tx = layer.grid.transaction();
        blit(&mut tx, rgba, at);
        drop(tx.commit());
        Ok(layer)
    }

    /// The layer's frame in page pixels.
    pub fn frame(&self) -> Rect {
        self.bounds.offset(self.anchor_x, self.anchor_y)
    }

    /// Fills the covered part of `mask` with one colour, in a single
    /// transaction, and hands back what changed.
    ///
    /// `mask` is A8 coverage over `mask_frame`, in page pixels. Nothing is
    /// returned when the coverage is empty — a fill that would write nothing is
    /// not a step worth being able to undo.
    /// `alpha_locked` is the layer's own switch: paint lands only where there is
    /// already coverage, and the alpha it lands on is left where it was.
    pub fn fill(
        &mut self,
        mask: &[u8],
        mask_frame: Rect,
        color: [u8; 4],
        alpha_locked: bool,
    ) -> Result<Option<(LayerJournal, Patch)>, String> {
        if color[3] == 0 {
            return Ok(None);
        }
        self.write(mask, mask_frame, color, paint_blend(alpha_locked))
    }

    /// A fill worked out and not committed, over `at`. Same arguments, same
    /// answer, no record and no change to the layer.
    pub fn preview_fill(
        &self,
        mask: &[u8],
        mask_frame: Rect,
        at: Rect,
        color: [u8; 4],
        alpha_locked: bool,
    ) -> Result<Option<Vec<u8>>, String> {
        if color[3] == 0 {
            return Ok(None);
        }
        self.preview(mask, mask_frame, at, color, paint_blend(alpha_locked))
    }

    /// An erase worked out and not committed, over `at`.
    pub fn preview_erase(
        &self,
        mask: &[u8],
        mask_frame: Rect,
        at: Rect,
    ) -> Result<Option<Vec<u8>>, String> {
        self.preview(mask, mask_frame, at, [0, 0, 0, 255], Blend::Erase)
    }

    /// Takes the covered part of `mask` out of the layer, in a single
    /// transaction, and hands back what changed.
    ///
    /// The same machinery as a fill with one operator swapped. Erasing has
    /// nothing of its own in the data model: it puts coverage on the scratch
    /// like everything else and punches through when that scratch is committed.
    /// A tile emptied outright goes back to being no tile at all, which is the
    /// only spelling of transparent there is.
    pub fn erase(
        &mut self,
        mask: &[u8],
        mask_frame: Rect,
    ) -> Result<Option<(LayerJournal, Patch)>, String> {
        self.write(mask, mask_frame, [0, 0, 0, 255], Blend::Erase)
    }

    /// What the layer would look like over `at` with `mask` laid on it, worked
    /// out and handed back with nothing committed.
    ///
    /// Taking `&self` is the whole of that guarantee: neither the tiles nor the
    /// frame can move because this has no way to move them. What it does move
    /// through is `paint_mask` and the same three blends a write uses, so the
    /// picture shown during a stroke and the one the release leaves behind are
    /// one implementation rather than two that have to agree.
    ///
    /// `at` need not be `mask_frame`. A stroke asks for the segment it just
    /// drew while the frame stands still, and for the whole of a frame that
    /// moved — where the ground the mask never reached still has to come back,
    /// because the caller is about to rebuild its picture from it.
    ///
    /// Straight RGBA over `at`, or nothing when that rectangle is empty.
    fn preview(
        &self,
        mask: &[u8],
        mask_frame: Rect,
        at: Rect,
        color: [u8; 4],
        blend: Blend,
    ) -> Result<Option<Vec<u8>>, String> {
        check_mask(mask, mask_frame)?;
        let painted = mask_frame.offset(-self.anchor_x, -self.anchor_y);
        let shown = at.offset(-self.anchor_x, -self.anchor_y);
        if shown.is_empty() {
            return Ok(None);
        }

        let mut scratch = TileGrid::<Rgba8>::new();
        paint_mask(&mut scratch, mask, painted, color);

        let mut out = self.read(shown);
        let stride = shown.w as usize * 4;
        for coord in scratch.occupied().collect::<Vec<_>>() {
            let Some(tile) = scratch.tile(coord) else {
                continue;
            };
            let part = shown.intersect(tile_rect(coord));
            if part.is_empty() {
                continue;
            }
            for row in 0..part.h {
                for col in 0..part.w {
                    let from = ((part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize
                        + (part.x + col - coord.tx * TILE_SIZE) as usize)
                        * 4;
                    let to = (part.y + row - shown.y) as usize * stride
                        + (part.x + col - shown.x) as usize * 4;
                    let src = &tile.bytes()[from..from + 4];
                    let dst = &mut out[to..to + 4];
                    match blend {
                        Blend::Over => over(src, dst),
                        Blend::OverLocked => over_locked(src, dst),
                        Blend::Erase => punch(src, dst),
                    }
                    // A committed write gets this when the tile is released and
                    // a preview has no release to get it in. It is not tidiness:
                    // under straight alpha a transparent pixel that kept its
                    // colour drags that colour into its neighbours the moment
                    // anything resamples it, and leaving the two paths to differ
                    // here is the one way the last preview of a stroke could
                    // disagree with what the release leaves.
                    if dst[3] == 0 {
                        dst.fill(0);
                    }
                }
            }
        }
        Ok(Some(out))
    }

    fn write(
        &mut self,
        mask: &[u8],
        mask_frame: Rect,
        color: [u8; 4],
        blend: Blend,
    ) -> Result<Option<(LayerJournal, Patch)>, String> {
        check_mask(mask, mask_frame)?;
        let at = mask_frame.offset(-self.anchor_x, -self.anchor_y);
        if at.is_empty() {
            return Ok(None);
        }

        // The scratch layer: opened unconditionally, on an empty ground, and
        // written before anything reaches the layer itself. The mask is applied
        // here rather than at commit — what lands on the paper is already the
        // shape, so the commit has one job.
        let mut scratch = TileGrid::<Rgba8>::new();
        let painted = paint_mask(&mut scratch, mask, at, color);
        let written = painted.written;
        if written.is_empty() {
            return Ok(None);
        }

        /*
         * A tile the paint covers whole, in one opaque colour, comes out the
         * same in every one of its four thousand pixels — so every such tile of
         * one fill is one block, pointed at as many times as it is needed.
         *
         * Worked out on the way in and only on this path. A brush is the most
         * frequent writer there will ever be and can never produce a uniform
         * tile, so a detector that ran at every commit would be pure cost with
         * nothing to find. The rule is allowed to miss and never to be wrong: a
         * tile that is uniform for some other reason simply costs its own block.
         *
         * Three things make "uniform" untrue and each is refused outright.
         * Coverage short of full anywhere in the tile — a feathered or
         * antialiased edge — leaves the result depending on what was underneath,
         * and `paint_mask` only names a tile whose every pixel took the colour
         * whole. A colour short of opaque does the same, and so does the layer's
         * own alpha lock, which makes every pixel's result depend on the alpha
         * it landed on.
         */
        let solid = if blend == Blend::Over && color[3] == 255 && !painted.whole.is_empty() {
            let mut tile = Tile::<Rgba8>::blank();
            for pixel in tile.bytes_mut().chunks_exact_mut(4) {
                pixel.copy_from_slice(&color);
            }
            Some(Arc::new(tile))
        } else {
            None
        };

        // The scratch declares which tiles the record is about. Every tile it
        // holds carries coverage, because a tile the mask left blank never
        // became one — so there is no tile here whose commit would leave the
        // target's pointer where it was.
        let mut tx = self.grid.transaction();
        for coord in scratch.occupied().collect::<Vec<_>>() {
            match &solid {
                Some(block) if painted.whole.contains(&coord) => {
                    tx.hang(coord, Arc::clone(block));
                    continue;
                }
                _ => {}
            }
            let source = scratch.tile(coord).expect("occupied names a tile");
            let mut target = tx.edit(coord);
            let out = target.bytes_mut();
            for (src, dst) in source.bytes().chunks_exact(4).zip(out.chunks_exact_mut(4)) {
                match blend {
                    Blend::Over => over(src, dst),
                    Blend::OverLocked => over_locked(src, dst),
                    Blend::Erase => punch(src, dst),
                }
            }
        }
        let tiles = tx.commit();

        let before = self.bounds;
        // Only paint moves a frame. Taking pixels out could shrink one, but a
        // frame that shrank would have to be recomputed from the whole layer,
        // and a frame larger than its content costs a little disk while a frame
        // smaller than its content loses pixels.
        if blend != Blend::Erase {
            self.bounds = self.bounds.union(written);
        }
        let journal = LayerJournal {
            layer: String::new(),
            tiles,
            bounds: before,
        };
        let patch = self.patch_for(&journal.tiles, before);
        Ok(Some((journal, patch)))
    }

    /// Swaps the journal into the layer and the layer's state into the journal.
    /// Applying twice returns to where it started, which is why undo and redo
    /// need no separate path.
    pub fn apply(&mut self, journal: &mut LayerJournal) -> Patch {
        let before = self.bounds;
        journal.tiles.apply(&mut self.grid);
        self.bounds = std::mem::replace(&mut journal.bounds, before);
        self.patch_for(&journal.tiles, before)
    }

    /// What to hand back after a write: the tiles it touched, or the whole
    /// frame when the frame itself moved.
    ///
    /// A moved frame means the caller's own picture is the wrong size and in the
    /// wrong place, so a patch of a few tiles would have nowhere correct to
    /// land. Handing the whole frame back keeps one paste path instead of two.
    fn patch_for(&self, tiles: &TileJournal<Rgba8>, before: Rect) -> Patch {
        let frame = self.frame();
        if before != self.bounds {
            return Patch {
                frame,
                changed: frame,
                rgba: self.read(self.bounds),
            };
        }
        let mut changed = Rect::EMPTY;
        for coord in tiles.coords() {
            changed = changed.union(tile_rect(coord));
        }
        let changed = changed.intersect(self.bounds);
        if changed.is_empty() {
            return Patch {
                frame,
                changed: Rect::EMPTY,
                rgba: Vec::new(),
            };
        }
        Patch {
            frame,
            changed: changed.offset(self.anchor_x, self.anchor_y),
            rgba: self.read(changed),
        }
    }

    /// Straight RGBA over a rectangle of the page.
    pub fn pixels(&self, at: Rect) -> Vec<u8> {
        self.read(at.offset(-self.anchor_x, -self.anchor_y))
    }

    /// Straight RGBA over a layer-local rectangle. Ground no tile stands on
    /// reads as transparent, which is what the zeroes it starts as already say.
    fn read(&self, at: Rect) -> Vec<u8> {
        let mut out = vec![0u8; (at.w.max(0) as usize) * (at.h.max(0) as usize) * 4];
        if at.is_empty() {
            return out;
        }
        let (tx0, ty0, tx1, ty1) = tile_span(at);
        let stride = at.w as usize * 4;
        for ty in ty0..=ty1 {
            for tx in tx0..=tx1 {
                let coord = TileCoord::new(tx, ty);
                let Some(tile) = self.grid.tile(coord) else {
                    continue;
                };
                let part = at.intersect(tile_rect(coord));
                if part.is_empty() {
                    continue;
                }
                let run = part.w as usize * 4;
                for row in 0..part.h {
                    let from = ((part.y + row - coord.ty * TILE_SIZE) as usize
                        * TILE_SIZE as usize
                        + (part.x - coord.tx * TILE_SIZE) as usize)
                        * 4;
                    let to = (part.y + row - at.y) as usize * stride + (part.x - at.x) as usize * 4;
                    out[to..to + run].copy_from_slice(&tile.bytes()[from..from + run]);
                }
            }
        }
        out
    }
}

/// Copies straight RGBA into a grid, one tile at a time.
///
/// A run that is entirely transparent is skipped rather than written and swept
/// up afterwards. Correctness does not need it — a blank tile is dropped when
/// the edit is released — but taking over a mostly-empty layer would otherwise
/// allocate a tile for every part of it that has nothing in it.
fn blit(tx: &mut TileTransaction<'_, Rgba8>, src: &[u8], at: Rect) {
    if at.is_empty() {
        return;
    }
    let (tx0, ty0, tx1, ty1) = tile_span(at);
    let stride = at.w as usize * 4;
    for ty in ty0..=ty1 {
        for txi in tx0..=tx1 {
            let coord = TileCoord::new(txi, ty);
            let part = at.intersect(tile_rect(coord));
            if part.is_empty() {
                continue;
            }
            let run = part.w as usize * 4;
            let source_at =
                |row: i32| (part.y + row - at.y) as usize * stride + (part.x - at.x) as usize * 4;
            if (0..part.h).all(|row| {
                src[source_at(row)..source_at(row) + run]
                    .iter()
                    .all(|&b| b == 0)
            }) {
                continue;
            }
            let mut tile = tx.edit(coord);
            let bytes = tile.bytes_mut();
            for row in 0..part.h {
                let to = ((part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize
                    + (part.x - coord.tx * TILE_SIZE) as usize)
                    * 4;
                let from = source_at(row);
                bytes[to..to + run].copy_from_slice(&src[from..from + run]);
            }
        }
    }
}

/// What laying the paint down came to.
struct Painted {
    /// The tight rectangle the paint actually reached.
    written: Rect,
    /// Tiles the mask covered whole, every pixel of them at full coverage.
    ///
    /// Named here because here is where it is free: the pass is already looking
    /// at every byte of the mask, and the answer would otherwise have to be
    /// found again by scanning the result. Whether being covered whole makes the
    /// finished tile uniform is the caller's to decide — the colour and the
    /// layer's own switches decide that, and this only says the mask left
    /// nothing of the tile showing.
    whole: HashSet<TileCoord>,
}

/// Lays one colour onto the scratch wherever the mask covers, and reports the
/// tight rectangle it actually wrote.
///
/// The coverage scales the colour's own alpha, so a feathered edge arrives as
/// alpha rather than as colour — under straight alpha, multiplying coverage into
/// the channels is what makes a pasted feathered selection darken every time it
/// is copied.
fn paint_mask(scratch: &mut TileGrid<Rgba8>, mask: &[u8], at: Rect, color: [u8; 4]) -> Painted {
    let mut written = Rect::EMPTY;
    let mut whole = HashSet::new();
    let (tx0, ty0, tx1, ty1) = tile_span(at);
    let mut tx = scratch.transaction();
    for ty in ty0..=ty1 {
        for txi in tx0..=tx1 {
            let coord = TileCoord::new(txi, ty);
            let part = at.intersect(tile_rect(coord));
            if part.is_empty() {
                continue;
            }
            let mut covered = Rect::EMPTY;
            // Only a tile the mask reaches every corner of can come out uniform,
            // and only then if every one of those pixels took the colour whole.
            let mut all = part.w == TILE_SIZE && part.h == TILE_SIZE;
            for row in 0..part.h {
                let line = (part.y + row - at.y) as usize * at.w as usize;
                for col in 0..part.w {
                    let coverage = mask[line + (part.x + col - at.x) as usize];
                    if coverage != 255 {
                        all = false;
                    }
                    if coverage == 0 {
                        continue;
                    }
                    covered = covered.union(Rect {
                        x: part.x + col,
                        y: part.y + row,
                        w: 1,
                        h: 1,
                    });
                }
            }
            if covered.is_empty() {
                continue;
            }
            if all {
                whole.insert(coord);
            }
            written = written.union(covered);

            let mut tile = tx.edit(coord);
            let bytes = tile.bytes_mut();
            for row in 0..covered.h {
                let line = (covered.y + row - at.y) as usize * at.w as usize;
                for col in 0..covered.w {
                    let coverage = mask[line + (covered.x + col - at.x) as usize] as u32;
                    if coverage == 0 {
                        continue;
                    }
                    let to = ((covered.y + row - coord.ty * TILE_SIZE) as usize
                        * TILE_SIZE as usize
                        + (covered.x + col - coord.tx * TILE_SIZE) as usize)
                        * 4;
                    bytes[to] = color[0];
                    bytes[to + 1] = color[1];
                    bytes[to + 2] = color[2];
                    bytes[to + 3] = ((color[3] as u32 * coverage + 127) / 255) as u8;
                }
            }
        }
    }
    drop(tx.commit());
    Painted { written, whole }
}

// ────────────────────────────────────────────────────────────────────────────
// The registry

#[derive(Default)]
struct Registry {
    layers: HashMap<String, RasterLayer>,
    journals: HashMap<String, LayerJournal>,
    /// The records in the order they were made, oldest first. Trimming takes
    /// from this end, so what falls away is the work furthest from where the
    /// person is.
    order: Vec<String>,
    next_journal: u64,
    /// Where a stroke in progress has provisionally taken each layer's frame.
    ///
    /// Kept here rather than being worked out by whoever is drawing, because a
    /// frame is the engine's to name: it is what tile coordinates are measured
    /// from and what the manifest is told. A caller that arrived at its own
    /// answer would be a second authority on the same rectangle, and the two of
    /// them disagreeing at the release is silent — the picture on screen is
    /// rebuilt from a frame nothing else believes in.
    ///
    /// A write clears it, because a write settles the real one.
    previews: HashMap<String, Rect>,
}

impl Registry {
    fn forget(&mut self, name: &str) {
        self.journals.remove(name);
        self.order.retain(|held| held != name);
    }

    /// What every record together is holding, counting a shared block once
    /// however many records point at it.
    ///
    /// Taken across the whole of history rather than summed per record, because
    /// per-record sums cannot see that two of them point at the same block —
    /// which is the number that decides whether anything is trimmed at all.
    fn bytes_held(&self) -> usize {
        let mut seen: HashSet<*const Tile<Rgba8>> = HashSet::new();
        let mut total = 0;
        for journal in self.journals.values() {
            for tile in journal.tiles.tiles() {
                if seen.insert(Arc::as_ptr(tile)) {
                    total += tile.byte_len();
                }
            }
        }
        total
    }
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> MutexGuard<'static, Registry> {
    REGISTRY
        .get_or_init(Mutex::default)
        // A panic inside one call must not take every later one with it: the
        // registry is a plain map, and whatever it holds is still readable.
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Hands a layer's whole pixels over. Called once, on the first edit.
pub fn take(id: &str, rgba: &[u8], frame: Rect) -> Result<(), String> {
    let layer = RasterLayer::take(rgba, frame)?;
    registry().layers.insert(id.to_string(), layer);
    Ok(())
}

pub fn holds(id: &str) -> bool {
    registry().layers.contains_key(id)
}

/// A held layer's own pixels over a rectangle of the page, straight RGBA.
///
/// Ground the layer does not cover reads as transparent, which is what the
/// zeroes it starts as already say — so a rectangle reaching past the frame is
/// answered rather than refused.
pub fn read(id: &str, at: Rect) -> Result<Vec<u8>, String> {
    let held = registry();
    let layer = held
        .layers
        .get(id)
        .ok_or_else(|| format!("layer {id} is not held by the engine"))?;
    Ok(layer.pixels(at))
}

/// Lets a layer go, along with every journal that speaks for it — a record of
/// pixels nobody holds any more cannot be applied to anything.
pub fn release(id: &str) {
    let mut held = registry();
    held.layers.remove(id);
    held.previews.remove(id);
    held.journals.retain(|_, journal| journal.layer != id);
    let kept: Vec<String> = held.journals.keys().cloned().collect();
    held.order.retain(|name| kept.contains(name));
}

/// Lets go of everything. Turning the page.
pub fn release_all() {
    let mut held = registry();
    held.layers.clear();
    held.previews.clear();
    held.journals.clear();
    held.order.clear();
}

/// What pixel history is holding in memory right now.
///
/// Asked here rather than worked out by whatever holds the undo stack: a block
/// shared between records looks like two from outside and is one from inside,
/// and only inside can count it right.
pub fn history_bytes() -> usize {
    registry().bytes_held()
}

/// Drops the oldest records until history is under `ceiling` bytes, keeping at
/// least `floor` of them whatever they weigh, and names what it dropped.
///
/// The floor wins, which is what makes both of the pure schemes' complaints
/// impossible: a step count alone leaves somebody asking why this is eating
/// three hundred megabytes, a byte budget alone leaves them asking why they can
/// only go back three steps.
///
/// Called before a write allocates, never after. Building the new record first
/// and pruning afterwards is how a stack peaks at its ceiling plus a whole
/// canvas — a mistake worth avoiding here, where one layer of the largest page
/// is over half a gigabyte.
pub fn trim_history(floor: usize, ceiling: usize) -> Vec<String> {
    let held = &mut *registry();
    let mut dropped = Vec::new();
    while held.order.len() > floor && held.bytes_held() > ceiling {
        let name = held.order.remove(0);
        held.journals.remove(&name);
        dropped.push(name);
    }
    dropped
}

/// Fills the masked region of a held layer. The returned name is how the caller
/// asks for this write to be taken back.
pub fn fill(
    id: &str,
    mask: &[u8],
    mask_frame: Rect,
    color: [u8; 4],
    alpha_locked: bool,
) -> Result<Option<(String, Patch)>, String> {
    record(id, |layer| {
        layer.fill(mask, mask_frame, color, alpha_locked)
    })
}

/// Takes the masked region out of a held layer. The returned name is how the
/// caller asks for this write to be taken back.
pub fn erase(id: &str, mask: &[u8], mask_frame: Rect) -> Result<Option<(String, Patch)>, String> {
    record(id, |layer| layer.erase(mask, mask_frame))
}

/// Starts a run of previews against a layer: the frame they stand on begins
/// again from the committed one.
///
/// Called as a stroke begins. A run left unfinished — a stroke that drew only
/// where a selection cut it away, so no write ever settled the frame — is ended
/// by the next run rather than by anyone remembering to close it.
pub fn preview_begin(id: &str) {
    registry().previews.remove(id);
}

/// What a fill would leave, without leaving it. No record is filed, so nothing
/// here is reachable by undo — there is nothing to take back.
pub fn preview_fill(
    id: &str,
    mask: &[u8],
    mask_frame: Rect,
    color: [u8; 4],
    alpha_locked: bool,
) -> Result<Option<Preview>, String> {
    if color[3] == 0 {
        return Ok(None);
    }
    preview_run(id, mask, mask_frame, true, |layer, at| {
        layer.preview_fill(mask, mask_frame, at, color, alpha_locked)
    })
}

/// What an erase would leave, on the same terms.
pub fn preview_erase(id: &str, mask: &[u8], mask_frame: Rect) -> Result<Option<Preview>, String> {
    // Taking pixels out never moves a frame, so neither may showing it about to
    // happen. A preview standing on a frame the release will not arrive at is
    // one the caller rebuilds its whole picture against and then loses.
    preview_run(id, mask, mask_frame, false, |layer, at| {
        layer.preview_erase(mask, mask_frame, at)
    })
}

/// Works out where the frame stands part-way through a stroke, and how much of
/// the layer the caller has to be handed to draw it.
///
/// The frame is grown by the same arithmetic a write grows it by — the tight
/// box of what the mask actually covered — so the rectangle a preview names and
/// the rectangle the release settles on are arrived at the same way and cannot
/// drift apart.
///
/// While that frame stands still only the masked region comes back. When it
/// moves, the whole of it does: the caller's picture is the wrong size and in
/// the wrong place, and a patch of it would have nowhere correct to land. That
/// is the rule a committed write already follows.
fn preview_run(
    id: &str,
    mask: &[u8],
    mask_frame: Rect,
    // `grows` says whether this direction of write moves a frame at all. Paint
    // does; taking pixels out does not, and a preview has to move exactly when
    // its write would, or the caller rebuilds against a frame nothing arrives at.
    grows: bool,
    render: impl FnOnce(&RasterLayer, Rect) -> Result<Option<Vec<u8>>, String>,
) -> Result<Option<Preview>, String> {
    check_mask(mask, mask_frame)?;
    let covered = covered_bounds(mask, mask_frame);
    if covered.is_empty() {
        return Ok(None);
    }

    let held = &mut *registry();
    let layer = held
        .layers
        .get(id)
        .ok_or_else(|| format!("layer {id} is not held by the engine"))?;

    let stood = held.previews.get(id).copied().unwrap_or_else(|| layer.frame());
    let frame = if grows { with_slack(stood, covered) } else { stood };

    /*
     * A frame that moved is answered with the frame and nothing else.
     *
     * What the caller needs then is the whole of it, and the whole of it holds
     * more than this mask knows about: everything drawn earlier in the stroke
     * is uncommitted and lives only on the picture the move is about to
     * replace. Painting it here from one segment's coverage would be a picture
     * the caller has to throw away, and a frame-sized one at that — so it is
     * not painted, and the caller asks again with everything it has.
     */
    held.previews.insert(id.to_string(), frame);
    if frame != stood {
        return Ok(Some(Preview {
            frame,
            changed: Rect::EMPTY,
            rgba: Vec::new(),
        }));
    }

    let Some(rgba) = render(layer, mask_frame)? else {
        return Ok(None);
    };
    Ok(Some(Preview {
        frame,
        changed: mask_frame,
        rgba,
    }))
}

/// Runs one write against a held layer and files the record it produced.
type Written = Result<Option<(LayerJournal, Patch)>, String>;

fn record(
    id: &str,
    write: impl FnOnce(&mut RasterLayer) -> Written,
) -> Result<Option<(String, Patch)>, String> {
    let mut held = registry();
    let layer = held
        .layers
        .get_mut(id)
        .ok_or_else(|| format!("layer {id} is not held by the engine"))?;
    let Some((mut journal, patch)) = write(layer)? else {
        return Ok(None);
    };
    // The frame is settled now, so nothing provisional about it survives.
    held.previews.remove(id);
    held.next_journal += 1;
    let name = format!("j{}", held.next_journal);
    journal.layer = id.to_string();
    held.journals.insert(name.clone(), journal);
    held.order.push(name.clone());
    Ok(Some((name, patch)))
}

/// Swaps a journal against its layer. The same call undoes and redoes, because
/// swapping is its own inverse.
pub fn apply_journal(name: &str) -> Option<Patch> {
    let held = &mut *registry();
    let journal = held.journals.get_mut(name)?;
    let layer = held.layers.get_mut(&journal.layer)?;
    held.previews.remove(&journal.layer);
    Some(layer.apply(journal))
}

/// Forgets a journal, which is what history falling off the bottom means.
pub fn drop_journal(name: &str) {
    registry().forget(name);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 4] = [255, 0, 0, 255];

    /// The registry is one global table and the test runner is threaded, so
    /// anything that touches it has to take this first. Without it two tests
    /// clear each other's layers and both report someone else's arithmetic.
    static EXCLUSIVE: Mutex<()> = Mutex::new(());

    fn alone() -> MutexGuard<'static, ()> {
        let guard = EXCLUSIVE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        release_all();
        guard
    }

    fn frame(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }

    /// A layer of one solid colour, `w` by `h`, sitting at (x, y).
    fn solid(at: Rect, color: [u8; 4]) -> RasterLayer {
        let px = (at.w * at.h) as usize;
        let mut rgba = Vec::with_capacity(px * 4);
        for _ in 0..px {
            rgba.extend_from_slice(&color);
        }
        RasterLayer::take(&rgba, at).expect("a well-formed layer")
    }

    fn full_mask(w: i32, h: i32) -> Vec<u8> {
        vec![255u8; (w * h) as usize]
    }

    /// How many distinct blocks a layer's tiles come to, by pointer.
    fn blocks(layer: &RasterLayer) -> usize {
        let mut seen: HashSet<*const Tile<Rgba8>> = HashSet::new();
        for coord in layer.grid.occupied() {
            if let Some(tile) = layer.grid.tile(coord) {
                seen.insert(Arc::as_ptr(&tile));
            }
        }
        seen.len()
    }

    /// A transparent page of `tiles` by `tiles`, and a fill that covers all of
    /// it — the shape a page being painted out white really has.
    fn painted_out(tiles: i32, color: [u8; 4], alpha_locked: bool) -> RasterLayer {
        let side = TILE_SIZE * tiles;
        let mut layer = solid(frame(0, 0, side, side), [0, 0, 0, 0]);
        layer
            .fill(
                &full_mask(side, side),
                frame(0, 0, side, side),
                color,
                alpha_locked,
            )
            .expect("a well-formed fill")
            .expect("something to fill");
        layer
    }

    fn pixel(layer: &RasterLayer, page_x: i32, page_y: i32) -> Vec<u8> {
        layer.read(frame(
            page_x - layer.anchor_x,
            page_y - layer.anchor_y,
            1,
            1,
        ))
    }

    #[test]
    fn a_layer_arrives_whole_and_reads_back_the_same() {
        let layer = solid(frame(10, 20, 3, 2), [1, 2, 3, 255]);
        assert_eq!(layer.frame(), frame(10, 20, 3, 2));
        assert_eq!(layer.read(frame(0, 0, 3, 2)), [1, 2, 3, 255].repeat(6));
    }

    #[test]
    fn a_layer_of_the_wrong_length_is_refused() {
        assert!(RasterLayer::take(&[0, 0, 0, 0], frame(0, 0, 2, 2)).is_err());
    }

    #[test]
    fn a_transparent_layer_costs_no_tiles() {
        let layer = solid(frame(0, 0, 200, 200), [0, 0, 0, 0]);
        assert_eq!(layer.grid.tile_count(), 0);
    }

    #[test]
    fn a_fill_lands_on_the_layer_itself() {
        let mut layer = solid(frame(0, 0, 8, 8), [0, 0, 0, 0]);
        let (_, patch) = layer
            .fill(&full_mask(4, 4), frame(2, 2, 4, 4), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(patch.frame, frame(0, 0, 8, 8));
        assert_eq!(pixel(&layer, 2, 2), RED.to_vec());
        assert_eq!(pixel(&layer, 5, 5), RED.to_vec());
        assert_eq!(pixel(&layer, 6, 6), vec![0, 0, 0, 0]);
    }

    #[test]
    fn a_fill_covering_nothing_is_not_a_step() {
        let mut layer = solid(frame(0, 0, 8, 8), [0, 0, 0, 0]);
        let empty = vec![0u8; 16];
        assert!(
            layer
                .fill(&empty, frame(0, 0, 4, 4), RED, false)
                .expect("a well-formed fill")
                .is_none()
        );
    }

    #[test]
    fn a_fully_transparent_colour_is_not_a_step_either() {
        let mut layer = solid(frame(0, 0, 8, 8), [0, 0, 0, 0]);
        assert!(
            layer
                .fill(&full_mask(4, 4), frame(0, 0, 4, 4), [255, 0, 0, 0], false)
                .expect("a well-formed fill")
                .is_none()
        );
    }

    #[test]
    fn coverage_arrives_as_alpha_rather_than_as_colour() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 0, 0]);
        let mask = vec![128u8, 0, 0, 0];
        layer
            .fill(&mask, frame(0, 0, 4, 1), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        // Half covered: the colour is untouched and the alpha carries the edge.
        assert_eq!(pixel(&layer, 0, 0), vec![255, 0, 0, 128]);
    }

    #[test]
    fn a_fill_over_an_opaque_layer_replaces_it() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 255, 255]);
        layer
            .fill(&full_mask(2, 2), frame(0, 0, 2, 2), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert_eq!(pixel(&layer, 0, 0), RED.to_vec());
        assert_eq!(pixel(&layer, 3, 3), vec![0, 0, 255, 255]);
    }

    #[test]
    fn a_half_covered_fill_composites_over_what_is_there() {
        let mut layer = solid(frame(0, 0, 2, 1), [0, 0, 0, 255]);
        let mask = vec![255u8, 0];
        layer
            .fill(&mask, frame(0, 0, 2, 1), [255, 255, 255, 128], false)
            .expect("a well-formed fill")
            .expect("something to fill");

        let mixed = pixel(&layer, 0, 0);
        assert_eq!(mixed[3], 255);
        // Half of white over black, give or take the rounding.
        assert!((mixed[0] as i32 - 128).abs() <= 1, "{mixed:?}");
        assert_eq!(pixel(&layer, 1, 0), vec![0, 0, 0, 255]);
    }

    #[test]
    fn the_patch_carries_only_the_tiles_that_moved() {
        let mut layer = solid(frame(0, 0, 300, 300), [0, 0, 0, 0]);
        let (_, patch) = layer
            .fill(&full_mask(4, 4), frame(70, 70, 4, 4), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        // One tile, the one holding (70, 70).
        assert_eq!(patch.changed, frame(64, 64, 64, 64));
        assert_eq!(patch.rgba.len(), 64 * 64 * 4);
        assert_eq!(patch.frame, frame(0, 0, 300, 300));
    }

    #[test]
    fn a_fill_past_the_left_edge_grows_the_frame() {
        let mut layer = solid(frame(100, 100, 10, 10), [0, 0, 255, 255]);
        let (_, patch) = layer
            .fill(&full_mask(20, 4), frame(90, 100, 20, 4), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(layer.frame(), frame(90, 100, 20, 10));
        // A moved frame hands the whole of it back, because the caller's own
        // picture is now the wrong size.
        assert_eq!(patch.frame, patch.changed);
        assert_eq!(patch.rgba.len(), 20 * 10 * 4);
        assert_eq!(pixel(&layer, 90, 100), RED.to_vec());
        assert_eq!(pixel(&layer, 90, 105), vec![0, 0, 0, 0]);
        assert_eq!(pixel(&layer, 100, 105), vec![0, 0, 255, 255]);
    }

    #[test]
    fn undo_and_redo_are_the_same_call() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 255, 255]);
        let (mut journal, _) = layer
            .fill(&full_mask(2, 2), frame(0, 0, 2, 2), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert_eq!(pixel(&layer, 0, 0), RED.to_vec());

        layer.apply(&mut journal);
        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 255, 255]);

        layer.apply(&mut journal);
        assert_eq!(pixel(&layer, 0, 0), RED.to_vec());
    }

    #[test]
    fn undoing_a_fill_that_grew_the_frame_puts_the_frame_back() {
        let mut layer = solid(frame(100, 100, 10, 10), [0, 0, 255, 255]);
        let (mut journal, _) = layer
            .fill(&full_mask(20, 4), frame(90, 100, 20, 4), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert_eq!(layer.frame(), frame(90, 100, 20, 10));

        let patch = layer.apply(&mut journal);
        assert_eq!(layer.frame(), frame(100, 100, 10, 10));
        assert_eq!(patch.frame, frame(100, 100, 10, 10));
        assert_eq!(pixel(&layer, 100, 100), vec![0, 0, 255, 255]);

        layer.apply(&mut journal);
        assert_eq!(layer.frame(), frame(90, 100, 20, 10));
        assert_eq!(pixel(&layer, 90, 100), RED.to_vec());
    }

    /// The bill this exists for. Every tile of a page painted out comes to the
    /// same four thousand pixels of one colour, so every tile of it is one
    /// block — sixteen tiles here, and sixteen thousand on a page.
    #[test]
    fn a_fill_that_covers_whole_tiles_shares_one_block() {
        let layer = painted_out(4, [255, 255, 255, 255], false);
        assert_eq!(layer.grid.tile_count(), 16);
        assert_eq!(blocks(&layer), 1);
        assert_eq!(pixel(&layer, 0, 0), vec![255, 255, 255, 255]);
        assert_eq!(
            pixel(&layer, TILE_SIZE * 4 - 1, TILE_SIZE * 4 - 1),
            vec![255, 255, 255, 255]
        );
    }

    /// Allowed to miss, never allowed to be wrong. A tile the mask only reaches
    /// part of pays for its own block, whatever the rest of it happens to hold.
    #[test]
    fn only_the_tiles_covered_whole_are_shared() {
        let side = TILE_SIZE * 2;
        let mut layer = solid(frame(0, 0, side, side), [0, 0, 0, 0]);
        // One whole tile and a strip of the one beside it.
        let covered = frame(0, 0, TILE_SIZE + 4, TILE_SIZE);
        layer
            .fill(&full_mask(covered.w, covered.h), covered, RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(layer.grid.tile_count(), 2);
        assert_eq!(blocks(&layer), 2);
        assert_eq!(pixel(&layer, TILE_SIZE + 3, 0), RED.to_vec());
        assert_eq!(pixel(&layer, TILE_SIZE + 4, 0), vec![0, 0, 0, 0]);
    }

    /// A colour short of opaque leaves the result depending on what was under
    /// it, so no two tiles are alike however completely they are covered.
    #[test]
    fn a_colour_short_of_opaque_shares_nothing() {
        let layer = painted_out(4, [255, 0, 0, 128], false);
        assert_eq!(layer.grid.tile_count(), 16);
        assert_eq!(blocks(&layer), 16);
    }

    /// Coverage short of full anywhere in a tile — a feathered or antialiased
    /// edge — is the same story, so the tile carrying it keeps its own block.
    #[test]
    fn a_feathered_edge_shares_nothing() {
        let side = TILE_SIZE * 2;
        let mut layer = solid(frame(0, 0, side, side), [0, 0, 0, 0]);
        let mut mask = full_mask(side, side);
        // One pixel of the second tile softened, which is all it takes.
        mask[(TILE_SIZE + 1) as usize] = 200;
        layer
            .fill(&mask, frame(0, 0, side, side), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(layer.grid.tile_count(), 4);
        assert_eq!(blocks(&layer), 2);
        assert_eq!(pixel(&layer, TILE_SIZE + 1, 0), vec![255, 0, 0, 200]);
    }

    /// The layer's own switch makes every pixel's result depend on the alpha it
    /// landed on, so nothing about the tile is uniform.
    #[test]
    fn an_alpha_locked_layer_shares_nothing() {
        let side = TILE_SIZE * 2;
        let mut layer = solid(frame(0, 0, side, side), [0, 0, 255, 255]);
        layer
            .fill(&full_mask(side, side), frame(0, 0, side, side), RED, true)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(blocks(&layer), 4);
    }

    #[test]
    fn an_alpha_locked_fill_lands_only_where_there_is_coverage() {
        let mut layer = solid(frame(0, 0, 2, 1), [0, 0, 0, 0]);
        // One pixel given something to hold on to, the other left empty.
        layer
            .fill(&[255, 0], frame(0, 0, 2, 1), [0, 0, 255, 255], false)
            .expect("a well-formed fill")
            .expect("something to fill");

        layer
            .fill(&[255, 255], frame(0, 0, 2, 1), RED, true)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(pixel(&layer, 0, 0), RED.to_vec());
        assert_eq!(pixel(&layer, 1, 0), vec![0, 0, 0, 0]);
    }

    #[test]
    fn an_alpha_locked_fill_keeps_a_soft_edge_as_soft_as_it_was() {
        let mut layer = solid(frame(0, 0, 1, 1), [0, 0, 0, 0]);
        layer
            .fill(&[128], frame(0, 0, 1, 1), [0, 0, 255, 255], false)
            .expect("a well-formed fill")
            .expect("something to fill");
        layer
            .fill(&[255], frame(0, 0, 1, 1), RED, true)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(pixel(&layer, 0, 0), vec![255, 0, 0, 128]);
    }

    /**
     * The whole of what a preview promises. It is asked for at every pointer
     * event of a stroke, so a layer that moved under one would have a hundred
     * uncommitted writes in it by the time the button came up.
     */
    #[test]
    fn a_preview_leaves_the_layer_where_it_found_it() {
        let side = TILE_SIZE * 2;
        let layer = solid(frame(0, 0, side, side), [0, 0, 255, 255]);
        let bounds = layer.bounds;
        let tiles = layer.grid.tile_count();
        let at = frame(0, 0, 8, 8);

        layer
            .preview_fill(&full_mask(at.w, at.h), at, at, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");

        assert_eq!(layer.bounds, bounds);
        assert_eq!(layer.grid.tile_count(), tiles);
        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 255, 255]);
    }

    /// One implementation rather than two that have to agree: what the last
    /// preview of a stroke showed is what the release leaves behind, byte for
    /// byte.
    #[test]
    fn a_preview_is_what_the_commit_leaves() {
        let side = TILE_SIZE * 2;
        let at = frame(4, 4, TILE_SIZE, TILE_SIZE);
        let mut mask = full_mask(at.w, at.h);
        // A soft corner, so the blend has something to do beyond copying.
        mask[0] = 90;
        mask[1] = 30;

        let mut layer = solid(frame(0, 0, side, side), [0, 0, 255, 255]);
        let shown = layer
            .preview_fill(&mask, at, at, [255, 0, 0, 128], false)
            .expect("a well-formed preview")
            .expect("something to show");
        layer
            .fill(&mask, at, [255, 0, 0, 128], false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(shown, layer.read(at));
    }

    /// The eraser too, which is the case a preview built from paint alone would
    /// get wrong: the hole has to be visible while the stroke is out.
    #[test]
    fn an_erase_preview_shows_the_hole_the_commit_will_punch() {
        let side = TILE_SIZE * 2;
        let at = frame(0, 0, 8, 8);
        let mut mask = full_mask(at.w, at.h);
        mask[4] = 120;

        let mut layer = solid(frame(0, 0, side, side), [0, 0, 255, 255]);
        let shown = layer
            .preview_erase(&mask, at, at)
            .expect("a well-formed preview")
            .expect("something to show");
        layer
            .erase(&mask, at)
            .expect("a well-formed erase")
            .expect("something to erase");

        assert_eq!(shown, layer.read(at));
        assert_eq!(&shown[0..4], &[0, 0, 0, 0]);
    }

    /// The lock is one blend picked one way, so it reaches the preview by the
    /// same road it reaches the commit.
    #[test]
    fn a_locked_preview_is_what_a_locked_commit_leaves() {
        let side = TILE_SIZE;
        let mut rgba = vec![0u8; (side * side) as usize * 4];
        for y in 0..side / 2 {
            for x in 0..side {
                let i = ((y * side + x) * 4) as usize;
                rgba[i + 2] = 255;
                rgba[i + 3] = 255;
            }
        }
        let mut layer =
            RasterLayer::take(&rgba, frame(0, 0, side, side)).expect("a well-formed layer");
        // Straddling the edge of what is there, so the lock has ground to
        // refuse as well as ground to accept.
        let at = frame(0, side / 2 - 2, 8, 4);
        let mask = full_mask(at.w, at.h);

        let shown = layer
            .preview_fill(&mask, at, at, RED, true)
            .expect("a well-formed preview")
            .expect("something to show");
        layer
            .fill(&mask, at, RED, true)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(shown, layer.read(at));
        assert_eq!(&shown[0..4], &[255, 0, 0, 255]);
        assert_eq!(&shown[(2 * at.w as usize) * 4..(2 * at.w as usize) * 4 + 4], &[0, 0, 0, 0]);
    }

    /**
     * The one rule that keeps a caller's picture alive: a preview may only move
     * the frame when the release is going to move it too.
     *
     * Moving it is what makes the caller rebuild, and a rebuild keeps only what
     * the answer it was given carries. The release hands back the whole frame
     * when its own bounds moved and a few tiles when they did not — so a
     * preview that moved the frame while the write will not is a rebuild fed by
     * a handful of tiles, and everything else the caller was showing is gone.
     *
     * Paint moves bounds. Taking pixels out never does.
     */
    #[test]
    fn a_preview_moves_the_frame_only_where_the_write_would() {
        let _guard = alone();
        let side = TILE_SIZE * 2;
        let rgba = vec![255u8; (side * side) as usize * 4];
        take("l", &rgba, frame(0, 0, side, side)).expect("a well-formed layer");
        let stood = frame(0, 0, side, side);

        // Paint that stays inside the frame leaves it exactly where it was.
        preview_begin("l");
        let inside = frame(10, 10, 8, 8);
        let shown = preview_fill("l", &full_mask(inside.w, inside.h), inside, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");
        assert_eq!(shown.frame, stood);
        assert_eq!(shown.changed, inside);

        // An eraser reaching past the edge does not move it either, because the
        // write it stands in for would not.
        preview_begin("l");
        let past = frame(side - 4, side - 4, 40, 40);
        let erased = preview_erase("l", &full_mask(past.w, past.h), past)
            .expect("a well-formed preview")
            .expect("something to show");
        assert_eq!(erased.frame, stood);
        assert_eq!(erased.changed, past);
    }

    /// Once it does have to move, it moves further than it had to, so the next
    /// few events find themselves already inside it. Rebuilding is the most
    /// expensive thing a stroke asks for; room to grow into is what stops it
    /// happening on every one.
    #[test]
    fn a_frame_that_has_to_move_takes_room_with_it() {
        let _guard = alone();
        take("l", &[], frame(0, 0, 0, 0)).expect("a well-formed layer");

        preview_begin("l");
        let first = frame(400, 400, 8, 8);
        let one = preview_fill("l", &full_mask(first.w, first.h), first, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");
        assert!(one.frame.w > first.w + PREVIEW_SLACK);
        // A move is answered with the frame alone: what the caller needs next
        // is the whole of it, and this mask cannot paint that.
        assert!(one.changed.is_empty());
        assert!(one.rgba.is_empty());

        // A step the slack already covers does not move it again.
        let next = frame(500, 430, 8, 8);
        let two = preview_fill("l", &full_mask(next.w, next.h), next, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");
        assert_eq!(two.frame, one.frame);
        assert_eq!(two.changed, next);
    }

    /**
     * The frame a run of previews arrives at holds everything the release will
     * settle on. It may hold more — the slack — and that is safe exactly
     * because moving it at all means the release moves its own bounds too, and
     * a release that moved its bounds hands the whole frame back.
     */
    #[test]
    fn a_run_of_previews_holds_the_frame_the_release_settles() {
        let _guard = alone();
        // No frame at all, which is where the frame has the furthest to move.
        take("l", &[], frame(0, 0, 0, 0)).expect("a well-formed layer");

        let first = frame(40, 40, 8, 8);
        let second = frame(90, 60, 8, 8);
        let both = frame(40, 40, 58, 28);
        let mut all = vec![0u8; (both.w * both.h) as usize];
        for part in [first, second] {
            for row in 0..part.h {
                for col in 0..part.w {
                    let at = (part.y + row - both.y) * both.w + (part.x + col - both.x);
                    all[at as usize] = 255;
                }
            }
        }
        let of = |part: Rect| -> Vec<u8> {
            let mut out = vec![0u8; (part.w * part.h) as usize];
            for row in 0..part.h {
                for col in 0..part.w {
                    let from = (part.y + row - both.y) * both.w + (part.x + col - both.x);
                    out[(row * part.w + col) as usize] = all[from as usize];
                }
            }
            out
        };

        let holds = |outer: Rect, inner: Rect| {
            inner.x >= outer.x
                && inner.y >= outer.y
                && inner.x + inner.w <= outer.x + outer.w
                && inner.y + inner.h <= outer.y + outer.h
        };

        preview_begin("l");
        let one = preview_fill("l", &of(first), first, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");
        // A frame that has to move is answered with the frame alone.
        assert!(holds(one.frame, first));
        assert!(one.changed.is_empty());

        let two = preview_fill("l", &of(second), second, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");
        assert!(holds(two.frame, both));

        let (_, patch) = fill("l", &all, both, RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        // The release settles tighter than the preview stood, and says so by
        // handing the whole frame back — which is what makes the two safe to
        // differ.
        assert!(holds(two.frame, patch.frame));
        assert_eq!(patch.changed, patch.frame);
    }

    /// A run that stays inside the frame leaves it alone, and only the masked
    /// region comes back — which is what keeps a stroke on a page-sized layer
    /// to a few kilobytes an event.
    #[test]
    fn a_preview_inside_the_frame_moves_nothing_and_returns_only_its_region() {
        let _guard = alone();
        let side = TILE_SIZE * 2;
        let rgba = vec![0u8; (side * side) as usize * 4];
        take("l", &rgba, frame(0, 0, side, side)).expect("a well-formed layer");

        preview_begin("l");
        let at = frame(10, 10, 8, 8);
        let shown = preview_fill("l", &full_mask(at.w, at.h), at, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");

        assert_eq!(shown.frame, frame(0, 0, side, side));
        assert_eq!(shown.changed, at);
        assert_eq!(shown.rgba.len(), (at.w * at.h) as usize * 4);
    }

    /// A run left unfinished — a stroke the selection cut away entirely, so no
    /// write ever settled the frame — must not lend its provisional frame to
    /// the next one.
    #[test]
    fn beginning_a_run_forgets_the_frame_the_last_one_stood_on() {
        let _guard = alone();
        take("l", &[], frame(0, 0, 0, 0)).expect("a well-formed layer");
        // Further off than any amount of slack could reach.
        let far = frame(4000, 4000, 8, 8);

        preview_begin("l");
        preview_fill("l", &full_mask(far.w, far.h), far, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");

        preview_begin("l");
        let near = frame(10, 10, 8, 8);
        let shown = preview_fill("l", &full_mask(near.w, near.h), near, RED, false)
            .expect("a well-formed preview")
            .expect("something to show");

        // Begun again from the committed frame, so it stands where this run put
        // it and nowhere near where the last one wandered off to.
        assert!(shown.frame.x + shown.frame.w < far.x);
    }

    /// Copy-on-write is what makes sharing safe: the block every tile points at
    /// is split by the first of them to be written to, and nobody else moves.
    #[test]
    fn writing_to_a_shared_tile_splits_it_off_first() {
        let mut layer = painted_out(4, [255, 255, 255, 255], false);
        assert_eq!(blocks(&layer), 1);

        layer
            .fill(&[255], frame(0, 0, 1, 1), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");

        assert_eq!(blocks(&layer), 2);
        assert_eq!(pixel(&layer, 0, 0), RED.to_vec());
        assert_eq!(pixel(&layer, 1, 0), vec![255, 255, 255, 255]);
        assert_eq!(pixel(&layer, TILE_SIZE, 0), vec![255, 255, 255, 255]);
    }

    #[test]
    fn an_erase_takes_the_covered_pixels_out() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 255, 255]);
        layer
            .erase(&full_mask(2, 2), frame(0, 0, 2, 2))
            .expect("a well-formed erase")
            .expect("something to erase");

        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 0, 0]);
        assert_eq!(pixel(&layer, 1, 1), vec![0, 0, 0, 0]);
        assert_eq!(pixel(&layer, 2, 2), vec![0, 0, 255, 255]);
    }

    // An eraser always goes all the way through: there is only one transparency.
    #[test]
    fn erasing_a_whole_tile_leaves_no_tile_behind() {
        let mut layer = solid(frame(0, 0, TILE_SIZE, TILE_SIZE), [0, 0, 255, 255]);
        assert_eq!(layer.grid.tile_count(), 1);

        layer
            .erase(
                &full_mask(TILE_SIZE, TILE_SIZE),
                frame(0, 0, TILE_SIZE, TILE_SIZE),
            )
            .expect("a well-formed erase")
            .expect("something to erase");

        assert_eq!(layer.grid.tile_count(), 0);
    }

    #[test]
    fn a_partly_covered_erase_thins_the_alpha_and_keeps_the_colour() {
        let mut layer = solid(frame(0, 0, 2, 1), [0, 0, 255, 255]);
        let mask = vec![128u8, 0];
        layer
            .erase(&mask, frame(0, 0, 2, 1))
            .expect("a well-formed erase")
            .expect("something to erase");

        let thinned = pixel(&layer, 0, 0);
        assert_eq!(&thinned[..3], &[0, 0, 255]);
        assert!((thinned[3] as i32 - 127).abs() <= 1, "{thinned:?}");
        assert_eq!(pixel(&layer, 1, 0), vec![0, 0, 255, 255]);
    }

    #[test]
    fn an_erase_over_nothing_is_not_a_step() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 0, 0]);
        assert!(
            layer
                .erase(&[0u8; 4], frame(0, 0, 2, 2))
                .expect("a well-formed erase")
                .is_none()
        );
    }

    // Only paint moves a frame. A frame that shrank would have to be recomputed
    // from the whole layer, and one larger than its content costs only disk.
    #[test]
    fn an_erase_leaves_the_frame_where_it_was() {
        let mut layer = solid(frame(5, 5, 4, 4), [0, 0, 255, 255]);
        layer
            .erase(&full_mask(4, 4), frame(5, 5, 4, 4))
            .expect("a well-formed erase")
            .expect("something to erase");
        assert_eq!(layer.frame(), frame(5, 5, 4, 4));
    }

    #[test]
    fn an_erase_is_taken_back_by_the_same_swap() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 255, 255]);
        let (mut journal, _) = layer
            .erase(&full_mask(2, 2), frame(0, 0, 2, 2))
            .expect("a well-formed erase")
            .expect("something to erase");
        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 0, 0]);

        layer.apply(&mut journal);
        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 255, 255]);

        layer.apply(&mut journal);
        assert_eq!(pixel(&layer, 0, 0), vec![0, 0, 0, 0]);
    }

    #[test]
    fn a_mask_of_the_wrong_length_is_refused() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 0, 0]);
        assert!(
            layer
                .fill(&[255, 255], frame(0, 0, 4, 4), RED, false)
                .is_err()
        );
    }

    #[test]
    fn the_registry_holds_a_layer_until_it_is_let_go() {
        let _alone = alone();
        take("a", &[0, 0, 0, 0], frame(0, 0, 1, 1)).expect("a well-formed layer");
        assert!(holds("a"));
        release("a");
        assert!(!holds("a"));
    }

    #[test]
    fn letting_a_layer_go_forgets_the_records_that_speak_for_it() {
        let _alone = alone();
        take("b", &[0, 0, 0, 0], frame(0, 0, 1, 1)).expect("a well-formed layer");
        let (name, _) = fill("b", &[255], frame(0, 0, 1, 1), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert!(apply_journal(&name).is_some());

        release("b");
        assert!(apply_journal(&name).is_none());
    }

    #[test]
    fn filling_a_layer_nobody_handed_over_is_an_error() {
        let _alone = alone();
        assert!(fill("nobody", &[255], frame(0, 0, 1, 1), RED, false).is_err());
    }

    /// A layer three tiles wide, and one fill per tile — three records holding
    /// one tile each. The layer is opaque so every record really is 16 KiB
    /// rather than nothing.
    fn three_records() -> (MutexGuard<'static, ()>, Vec<String>) {
        let alone = alone();
        let side = TILE_SIZE * 3;
        let px = (side * TILE_SIZE) as usize;
        let mut rgba = Vec::with_capacity(px * 4);
        for _ in 0..px {
            rgba.extend_from_slice(&[0, 0, 255, 255]);
        }
        take("wide", &rgba, frame(0, 0, side, TILE_SIZE)).expect("a well-formed layer");

        let names = (0..3)
            .map(|at| {
                let (name, _) = fill("wide", &[255], frame(at * TILE_SIZE, 0, 1, 1), RED, false)
                    .expect("a well-formed fill")
                    .expect("something to fill");
                name
            })
            .collect();
        (alone, names)
    }

    #[test]
    fn the_meter_counts_what_history_really_holds() {
        let (_alone, names) = three_records();
        assert_eq!(names.len(), 3);
        assert_eq!(history_bytes(), 3 * 16 * 1024);
    }

    #[test]
    fn the_meter_does_not_count_a_page_nobody_kept() {
        let _alone = alone();
        // A layer far larger than what any record of it holds: a record is the
        // tiles a write covered, not the page it happened on.
        let side = TILE_SIZE * 4;
        let rgba = vec![255u8; (side * side) as usize * 4];
        take("big", &rgba, frame(0, 0, side, side)).expect("a well-formed layer");
        assert_eq!(history_bytes(), 0);

        fill("big", &[255], frame(0, 0, 1, 1), RED, false)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert_eq!(history_bytes(), 16 * 1024);
    }

    #[test]
    fn nothing_is_trimmed_while_history_is_under_the_ceiling() {
        let (_alone, _names) = three_records();
        assert!(trim_history(1, 1024 * 1024).is_empty());
        assert_eq!(history_bytes(), 3 * 16 * 1024);
    }

    #[test]
    fn the_oldest_records_go_first() {
        let (_alone, names) = three_records();
        let dropped = trim_history(1, 16 * 1024);
        assert_eq!(dropped, vec![names[0].clone(), names[1].clone()]);
        assert_eq!(history_bytes(), 16 * 1024);
        assert!(apply_journal(&names[0]).is_none());
        assert!(apply_journal(&names[2]).is_some());
    }

    // The floor wins: a ceiling of nothing still leaves the last steps standing.
    #[test]
    fn the_step_floor_beats_the_byte_ceiling() {
        let (_alone, _names) = three_records();
        let dropped = trim_history(2, 0);
        assert_eq!(dropped.len(), 1);
        assert_eq!(history_bytes(), 2 * 16 * 1024);
    }

    #[test]
    fn a_floor_above_what_history_holds_trims_nothing() {
        let (_alone, _names) = three_records();
        assert!(trim_history(10, 0).is_empty());
    }

    #[test]
    fn forgetting_a_record_takes_it_out_of_the_order_too() {
        let (_alone, names) = three_records();
        drop_journal(&names[0]);
        assert_eq!(history_bytes(), 2 * 16 * 1024);
        // The one just forgotten must not come back as the oldest.
        assert_eq!(trim_history(1, 0), vec![names[1].clone()]);
    }
}
