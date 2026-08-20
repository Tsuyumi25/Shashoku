//! Raster layers the engine has taken over, and the writes that reach them.
//!
//! A layer arrives whole, once, the first time it is edited, and leaves when the
//! page is turned. While it is held, the engine owns its pixels: every write is
//! a transaction against the tile grid, and what comes back is only the part
//! that changed.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::tile::{Rgba8, TILE_SIZE, TileCoord, TileGrid, TileJournal, TileTransaction};

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

    fn right(&self) -> i32 {
        self.x + self.w
    }

    fn bottom(&self) -> i32 {
        self.y + self.h
    }

    /// An empty rectangle is the identity — a write that covered nothing must
    /// not drag a frame's corner to the origin.
    fn union(self, other: Rect) -> Rect {
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

    fn intersect(self, other: Rect) -> Rect {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        Rect {
            x,
            y,
            w: self.right().min(other.right()) - x,
            h: self.bottom().min(other.bottom()) - y,
        }
    }

    fn offset(self, dx: i32, dy: i32) -> Rect {
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

// ────────────────────────────────────────────────────────────────────────────
// Compositing

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
    pub fn fill(
        &mut self,
        mask: &[u8],
        mask_frame: Rect,
        color: [u8; 4],
    ) -> Result<Option<(LayerJournal, Patch)>, String> {
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
        let at = mask_frame.offset(-self.anchor_x, -self.anchor_y);
        if at.is_empty() || color[3] == 0 {
            return Ok(None);
        }

        // The scratch layer: opened unconditionally, on an empty ground, and
        // written before anything reaches the layer itself. The mask is applied
        // here rather than at commit — what lands on the paper is already the
        // shape, so the commit has one job.
        let mut scratch = TileGrid::<Rgba8>::new();
        let written = paint_mask(&mut scratch, mask, at, color);
        if written.is_empty() {
            return Ok(None);
        }

        // The scratch declares which tiles the record is about. Every tile it
        // holds carries coverage, because a tile the mask left blank never
        // became one — so there is no tile here whose commit would leave the
        // target's pointer where it was.
        let mut tx = self.grid.transaction();
        for coord in scratch.occupied().collect::<Vec<_>>() {
            let source = scratch.tile(coord).expect("occupied names a tile");
            let mut target = tx.edit(coord);
            let out = target.bytes_mut();
            for (src, dst) in source.bytes().chunks_exact(4).zip(out.chunks_exact_mut(4)) {
                over(src, dst);
            }
        }
        let tiles = tx.commit();

        let before = self.bounds;
        self.bounds = self.bounds.union(written);
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

/// Lays one colour onto the scratch wherever the mask covers, and reports the
/// tight rectangle it actually wrote.
///
/// The coverage scales the colour's own alpha, so a feathered edge arrives as
/// alpha rather than as colour — under straight alpha, multiplying coverage into
/// the channels is what makes a pasted feathered selection darken every time it
/// is copied.
fn paint_mask(scratch: &mut TileGrid<Rgba8>, mask: &[u8], at: Rect, color: [u8; 4]) -> Rect {
    let mut written = Rect::EMPTY;
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
            for row in 0..part.h {
                let line = (part.y + row - at.y) as usize * at.w as usize;
                for col in 0..part.w {
                    if mask[line + (part.x + col - at.x) as usize] == 0 {
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
    written
}

// ────────────────────────────────────────────────────────────────────────────
// The registry

#[derive(Default)]
struct Registry {
    layers: HashMap<String, RasterLayer>,
    journals: HashMap<String, LayerJournal>,
    next_journal: u64,
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

/// Lets a layer go, along with every journal that speaks for it — a record of
/// pixels nobody holds any more cannot be applied to anything.
pub fn release(id: &str) {
    let mut held = registry();
    held.layers.remove(id);
    held.journals.retain(|_, journal| journal.layer != id);
}

/// Lets go of everything. Turning the page.
pub fn release_all() {
    let mut held = registry();
    held.layers.clear();
    held.journals.clear();
}

/// Fills the masked region of a held layer. The returned name is how the caller
/// asks for this write to be taken back.
pub fn fill(
    id: &str,
    mask: &[u8],
    mask_frame: Rect,
    color: [u8; 4],
) -> Result<Option<(String, Patch)>, String> {
    let mut held = registry();
    let layer = held
        .layers
        .get_mut(id)
        .ok_or_else(|| format!("layer {id} is not held by the engine"))?;
    let Some((mut journal, patch)) = layer.fill(mask, mask_frame, color)? else {
        return Ok(None);
    };
    held.next_journal += 1;
    let name = format!("j{}", held.next_journal);
    journal.layer = id.to_string();
    held.journals.insert(name.clone(), journal);
    Ok(Some((name, patch)))
}

/// Swaps a journal against its layer. The same call undoes and redoes, because
/// swapping is its own inverse.
pub fn apply_journal(name: &str) -> Option<Patch> {
    let held = &mut *registry();
    let journal = held.journals.get_mut(name)?;
    let layer = held.layers.get_mut(&journal.layer)?;
    Some(layer.apply(journal))
}

/// Forgets a journal, which is what history falling off the bottom means.
pub fn drop_journal(name: &str) {
    registry().journals.remove(name);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 4] = [255, 0, 0, 255];

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
            .fill(&full_mask(4, 4), frame(2, 2, 4, 4), RED)
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
                .fill(&empty, frame(0, 0, 4, 4), RED)
                .expect("a well-formed fill")
                .is_none()
        );
    }

    #[test]
    fn a_fully_transparent_colour_is_not_a_step_either() {
        let mut layer = solid(frame(0, 0, 8, 8), [0, 0, 0, 0]);
        assert!(
            layer
                .fill(&full_mask(4, 4), frame(0, 0, 4, 4), [255, 0, 0, 0])
                .expect("a well-formed fill")
                .is_none()
        );
    }

    #[test]
    fn coverage_arrives_as_alpha_rather_than_as_colour() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 0, 0]);
        let mask = vec![128u8, 0, 0, 0];
        layer
            .fill(&mask, frame(0, 0, 4, 1), RED)
            .expect("a well-formed fill")
            .expect("something to fill");

        // Half covered: the colour is untouched and the alpha carries the edge.
        assert_eq!(pixel(&layer, 0, 0), vec![255, 0, 0, 128]);
    }

    #[test]
    fn a_fill_over_an_opaque_layer_replaces_it() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 255, 255]);
        layer
            .fill(&full_mask(2, 2), frame(0, 0, 2, 2), RED)
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
            .fill(&mask, frame(0, 0, 2, 1), [255, 255, 255, 128])
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
            .fill(&full_mask(4, 4), frame(70, 70, 4, 4), RED)
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
            .fill(&full_mask(20, 4), frame(90, 100, 20, 4), RED)
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
            .fill(&full_mask(2, 2), frame(0, 0, 2, 2), RED)
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
            .fill(&full_mask(20, 4), frame(90, 100, 20, 4), RED)
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

    #[test]
    fn a_mask_of_the_wrong_length_is_refused() {
        let mut layer = solid(frame(0, 0, 4, 4), [0, 0, 0, 0]);
        assert!(layer.fill(&[255, 255], frame(0, 0, 4, 4), RED).is_err());
    }

    #[test]
    fn the_registry_holds_a_layer_until_it_is_let_go() {
        release_all();
        take("a", &[0, 0, 0, 0], frame(0, 0, 1, 1)).expect("a well-formed layer");
        assert!(holds("a"));
        release("a");
        assert!(!holds("a"));
    }

    #[test]
    fn letting_a_layer_go_forgets_the_records_that_speak_for_it() {
        release_all();
        take("b", &[0, 0, 0, 0], frame(0, 0, 1, 1)).expect("a well-formed layer");
        let (name, _) = fill("b", &[255], frame(0, 0, 1, 1), RED)
            .expect("a well-formed fill")
            .expect("something to fill");
        assert!(apply_journal(&name).is_some());

        release("b");
        assert!(apply_journal(&name).is_none());
    }

    #[test]
    fn filling_a_layer_nobody_handed_over_is_an_error() {
        release_all();
        assert!(fill("nobody", &[255], frame(0, 0, 1, 1), RED).is_err());
    }
}
