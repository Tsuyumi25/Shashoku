//! The selection, held as tiles.
//!
//! A selection is a full-page 8-bit soft mask — 255 wholly selected, 0 not at
//! all, everything between real — and it runs on the same grid the pixels do:
//! same growth, same origin, same copy-on-write, one byte a pixel instead of
//! four. Krita's is the same arrangement, an alpha8 paint device on the ordinary
//! tile engine.
//!
//! Its identity does not change with its storage. It is editor state, it dies
//! with the project, it is not in the manifest and it is not on the layer tree.
//! What changes is the bill: a full-page mask at the largest page is 139 MB, and
//! selecting all or inverting has the whole page as its changed region, so two
//! of those in history is 278 MB for one command. As tiles it is tens of
//! thousands of pointers at a single four-kilobyte block.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use crate::raster::Rect;
use crate::tile::{Alpha8, TILE_SIZE, Tile, TileCoord, TileGrid, TileJournal};

/// The one selection there is, and what it is for.
///
/// Always present, even when nothing is selected: a grid with no tiles is what
/// "no selection" is made of, and having one always means a record can be
/// applied without asking whether there is anything to apply it to.
#[derive(Default)]
struct PageMask {
    /// The page this is a selection on, or none when there is no selection at
    /// all. Swapped by a record along with the tiles, so undoing back across a
    /// page carries the identity as well as the bytes.
    page: Option<String>,
    width: i32,
    height: i32,
    grid: TileGrid<Alpha8>,
    bounds: Option<Rect>,
}

/// One selection command's worth of undo.
///
/// Everything that makes a selection what it is swaps at once — which page, how
/// big, what is in it, and where its edges are. Deselecting and selecting on
/// another page are then the same kind of step as dragging a marquee, rather
/// than three cases somebody has to remember to handle.
struct MaskJournal {
    page: Option<String>,
    width: i32,
    height: i32,
    bounds: Option<Rect>,
    tiles: TileJournal<Alpha8>,
}

#[derive(Default)]
struct MaskState {
    held: PageMask,
    journals: HashMap<String, MaskJournal>,
    next_journal: u64,
}

static MASK: OnceLock<Mutex<MaskState>> = OnceLock::new();

fn state() -> MutexGuard<'static, MaskState> {
    MASK.get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl PageMask {
    fn page_rect(&self) -> Rect {
        Rect {
            x: 0,
            y: 0,
            w: self.width,
            h: self.height,
        }
    }

    /// The mask's own bytes over a rectangle, row by row. Zero where no tile
    /// stands, which is what "not selected" already is.
    fn read(&self, at: Rect) -> Vec<u8> {
        let mut out = vec![0u8; (at.w.max(0) as usize) * (at.h.max(0) as usize)];
        if at.is_empty() {
            return out;
        }
        let stride = at.w as usize;
        for (coord, part) in tiles_over(at) {
            let Some(tile) = self.grid.tile(coord) else {
                continue;
            };
            let run = part.w as usize;
            for row in 0..part.h {
                let from = (part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize
                    + (part.x - coord.tx * TILE_SIZE) as usize;
                let to = (part.y + row - at.y) as usize * stride + (part.x - at.x) as usize;
                out[to..to + run].copy_from_slice(&tile.bytes()[from..from + run]);
            }
        }
        out
    }

    /// The tight box of everything selected inside `scan`, or none when nothing
    /// there is.
    ///
    /// `scan` must contain the answer, and an operation's changed region unioned
    /// with the previous bounds always does. Saying so is what turns a page-wide
    /// sweep into a look at the box that moved.
    fn scan_bounds(&self, scan: Rect) -> Option<Rect> {
        let scan = scan.intersect(self.page_rect());
        if scan.is_empty() {
            return None;
        }
        let mut found: Option<Rect> = None;
        for (coord, part) in tiles_over(scan) {
            let Some(tile) = self.grid.tile(coord) else {
                continue;
            };
            for row in 0..part.h {
                let line = (part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize;
                for col in 0..part.w {
                    let at = line + (part.x + col - coord.tx * TILE_SIZE) as usize;
                    if tile.bytes()[at] == 0 {
                        continue;
                    }
                    let point = Rect {
                        x: part.x + col,
                        y: part.y + row,
                        w: 1,
                        h: 1,
                    };
                    found = Some(match found {
                        None => point,
                        Some(held) => held.union(point),
                    });
                }
            }
        }
        found
    }

    /// Opens a transaction, runs `write` inside it, and hands back the record
    /// that puts everything — page, size, bounds and tiles — back as it was.
    fn journal(
        &mut self,
        write: impl FnOnce(&mut TileGrid<Alpha8>) -> TileJournal<Alpha8>,
    ) -> MaskJournal {
        MaskJournal {
            page: self.page.clone(),
            width: self.width,
            height: self.height,
            bounds: self.bounds,
            tiles: write(&mut self.grid),
        }
    }

    fn apply(&mut self, journal: &mut MaskJournal) {
        journal.tiles.apply(&mut self.grid);
        std::mem::swap(&mut self.page, &mut journal.page);
        std::mem::swap(&mut self.width, &mut journal.width);
        std::mem::swap(&mut self.height, &mut journal.height);
        std::mem::swap(&mut self.bounds, &mut journal.bounds);
    }

    /// Empties the grid outright, recording every tile that was in it.
    fn take_everything(&mut self) -> MaskJournal {
        self.journal(|grid| {
            let mut tx = grid.transaction();
            for coord in grid_coords(tx.grid()) {
                tx.clear(coord);
            }
            tx.commit()
        })
    }
}

fn grid_coords(grid: &TileGrid<Alpha8>) -> Vec<TileCoord> {
    grid.occupied().collect()
}

/// Every tile a rectangle touches, with the part of the rectangle inside it.
fn tiles_over(at: Rect) -> Vec<(TileCoord, Rect)> {
    let mut out = Vec::new();
    if at.is_empty() {
        return out;
    }
    let tx0 = at.x.div_euclid(TILE_SIZE);
    let ty0 = at.y.div_euclid(TILE_SIZE);
    let tx1 = (at.x + at.w - 1).div_euclid(TILE_SIZE);
    let ty1 = (at.y + at.h - 1).div_euclid(TILE_SIZE);
    for ty in ty0..=ty1 {
        for tx in tx0..=tx1 {
            let coord = TileCoord::new(tx, ty);
            let part = at.intersect(Rect {
                x: tx * TILE_SIZE,
                y: ty * TILE_SIZE,
                w: TILE_SIZE,
                h: TILE_SIZE,
            });
            if !part.is_empty() {
                out.push((coord, part));
            }
        }
    }
    out
}

// ────────────────────────────────────────────────────────────────────────────
// What the renderer asks for

/// Which page the selection is on, if there is one.
pub fn page() -> Option<String> {
    state().held.page.clone()
}

/// The page grid the selection is measured in.
pub fn size() -> (i32, i32) {
    let held = state();
    (held.held.width, held.held.height)
}

pub fn bounds() -> Option<Rect> {
    state().held.bounds
}

pub fn read(region: Rect) -> Vec<u8> {
    state().held.read(region)
}

/// Starts an empty selection for a page, putting away whatever was held.
///
/// One selection at a time, as in Photoshop: making one somewhere else is what
/// takes the last one away, not turning to that page.
pub fn hold(page: &str, width: i32, height: i32) -> String {
    let held = &mut *state();
    let mut journal = held.held.take_everything();
    held.held.page = Some(page.to_string());
    held.held.width = width;
    held.held.height = height;
    held.held.bounds = None;
    file(held, &mut journal)
}

/// Nothing selected anywhere.
pub fn deselect() -> String {
    let held = &mut *state();
    let mut journal = held.held.take_everything();
    held.held.page = None;
    held.held.bounds = None;
    file(held, &mut journal)
}

/// Writes coverage over a region and works out where the edges are now.
///
/// `bytes` is one per pixel of `region`, row by row. Anything of the region
/// outside the page is dropped: a selection is measured in page pixels and there
/// is nothing outside them to select.
pub fn write(region: Rect, bytes: &[u8]) -> Result<String, String> {
    let wanted = (region.w.max(0) as usize)
        .checked_mul(region.h.max(0) as usize)
        .ok_or_else(|| "region is too large to describe".to_string())?;
    if bytes.len() != wanted {
        return Err(format!(
            "region of {}x{} needs {wanted} bytes, got {}",
            region.w,
            region.h,
            bytes.len()
        ));
    }
    let held = &mut *state();
    let page = held.held.page_rect();
    let clipped = region.intersect(page);
    let before = held.held.bounds;

    let mut journal = held.held.journal(|grid| {
        let mut tx = grid.transaction();
        for (coord, part) in tiles_over(clipped) {
            let mut tile = tx.edit(coord);
            let out = tile.bytes_mut();
            for row in 0..part.h {
                let from = (part.y + row - region.y) as usize * region.w as usize
                    + (part.x - region.x) as usize;
                let to = (part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize
                    + (part.x - coord.tx * TILE_SIZE) as usize;
                out[to..to + part.w as usize].copy_from_slice(&bytes[from..from + part.w as usize]);
            }
        }
        tx.commit()
    });

    held.held.bounds = held.held.scan_bounds(match before {
        None => clipped,
        Some(had) => had.union(clipped),
    });
    Ok(file(held, &mut journal))
}

/// Every pixel of the page selected.
///
/// The whole point of the tiles, and where the bill collapses: one block, hung
/// at every coordinate the page covers. Only the tiles hanging over an edge are
/// their own, because nothing outside the page is ever selected.
pub fn select_all() -> String {
    let held = &mut *state();
    let page = held.held.page_rect();
    let solid = Arc::new({
        let mut tile = Tile::<Alpha8>::blank();
        tile.bytes_mut().fill(255);
        tile
    });

    let mut journal = held.held.journal(|grid| {
        let mut tx = grid.transaction();
        for (coord, part) in tiles_over(page) {
            if part.w == TILE_SIZE && part.h == TILE_SIZE {
                tx.hang(coord, Arc::clone(&solid));
                continue;
            }
            let mut tile = tx.edit(coord);
            let out = tile.bytes_mut();
            for row in 0..part.h {
                let to = (part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize
                    + (part.x - coord.tx * TILE_SIZE) as usize;
                out[to..to + part.w as usize].fill(255);
            }
        }
        tx.commit()
    });

    held.held.bounds = if page.is_empty() { None } else { Some(page) };
    file(held, &mut journal)
}

/// Every value turned over, feathered edges included.
pub fn invert() -> String {
    let held = &mut *state();
    let page = held.held.page_rect();
    let mut journal = held.held.journal(|grid| {
        let mut tx = grid.transaction();
        for (coord, part) in tiles_over(page) {
            let mut tile = tx.edit(coord);
            let out = tile.bytes_mut();
            for row in 0..part.h {
                let line = (part.y + row - coord.ty * TILE_SIZE) as usize * TILE_SIZE as usize;
                for col in 0..part.w {
                    let at = line + (part.x + col - coord.tx * TILE_SIZE) as usize;
                    out[at] = 255 - out[at];
                }
            }
        }
        tx.commit()
    });

    held.held.bounds = held.held.scan_bounds(page);
    file(held, &mut journal)
}

/// Swaps a record against the selection. Undo and redo are the same call.
pub fn apply_journal(name: &str) {
    let held = &mut *state();
    let Some(journal) = held.journals.get_mut(name) else {
        return;
    };
    held.held.apply(journal);
}

pub fn drop_journal(name: &str) {
    state().journals.remove(name);
}

/// Folds a later record into an earlier one and forgets the later.
///
/// A brush stroke is one step however many segments it is made of, so its
/// segments write one after another and their records collapse into the first.
/// Without this a stroke of two hundred segments would hold two hundred copies
/// of every tile it crossed.
pub fn absorb_journal(into: &str, later: &str) {
    let held = &mut *state();
    let Some(taken) = held.journals.remove(later) else {
        return;
    };
    let Some(first) = held.journals.get_mut(into) else {
        return;
    };
    first.tiles.absorb(taken.tiles);
}

/// What the selection and its records are holding, counting a shared block once.
pub fn bytes_held() -> usize {
    let held = state();
    let mut seen: std::collections::HashSet<*const Tile<Alpha8>> = std::collections::HashSet::new();
    let mut total = 0;
    let mut take = |tile: &Arc<Tile<Alpha8>>| {
        if seen.insert(Arc::as_ptr(tile)) {
            total += tile.byte_len();
        }
    };
    for coord in held.held.grid.occupied() {
        if let Some(tile) = held.held.grid.tile(coord) {
            take(&tile);
        }
    }
    for journal in held.journals.values() {
        for tile in journal.tiles.tiles() {
            take(tile);
        }
    }
    total
}

/// Everything forgotten. A selection belongs to the project that made it, and
/// two projects can hold a page of the same name.
pub fn reset() {
    let held = &mut *state();
    held.held = PageMask::default();
    held.journals.clear();
}

fn file(held: &mut MaskState, journal: &mut MaskJournal) -> String {
    held.next_journal += 1;
    let name = format!("m{}", held.next_journal);
    held.journals.insert(
        name.clone(),
        MaskJournal {
            page: std::mem::take(&mut journal.page),
            width: journal.width,
            height: journal.height,
            bounds: journal.bounds,
            tiles: std::mem::take(&mut journal.tiles),
        },
    );
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    static EXCLUSIVE: Mutex<()> = Mutex::new(());

    /// One global selection and a threaded test runner, so anything that touches
    /// it takes this first.
    fn alone() -> MutexGuard<'static, ()> {
        let guard = EXCLUSIVE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        reset();
        guard
    }

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }

    fn covered(region: Rect) -> String {
        write(region, &vec![255u8; (region.w * region.h) as usize]).expect("a well-formed write")
    }

    #[test]
    fn nothing_is_held_to_begin_with() {
        let _alone = alone();
        assert_eq!(page(), None);
        assert_eq!(bounds(), None);
        assert_eq!(read(rect(0, 0, 2, 2)), vec![0, 0, 0, 0]);
    }

    #[test]
    fn a_selection_knows_which_page_it_is_for() {
        let _alone = alone();
        hold("p1", 128, 128);
        assert_eq!(page(), Some("p1".to_string()));
        assert_eq!(size(), (128, 128));
    }

    #[test]
    fn what_is_written_reads_back() {
        let _alone = alone();
        hold("p1", 128, 128);
        covered(rect(10, 10, 4, 4));

        assert_eq!(read(rect(10, 10, 2, 1)), vec![255, 255]);
        assert_eq!(read(rect(9, 10, 2, 1)), vec![0, 255]);
        assert_eq!(bounds(), Some(rect(10, 10, 4, 4)));
    }

    // A feathered edge is the whole reason the mask is 8-bit rather than a set
    // of pixels, and clipping it would put a jagged edge on the page.
    #[test]
    fn a_soft_edge_survives() {
        let _alone = alone();
        hold("p1", 128, 128);
        write(rect(0, 0, 3, 1), &[0, 128, 255]).expect("a well-formed write");
        assert_eq!(read(rect(0, 0, 3, 1)), vec![0, 128, 255]);
    }

    // The ants are drawn round any non-zero coverage, so the box has to hold a
    // pixel that is barely selected as surely as one that wholly is.
    #[test]
    fn the_faintest_coverage_still_counts_as_selected() {
        let _alone = alone();
        hold("p1", 128, 128);
        write(rect(5, 5, 1, 1), &[1]).expect("a well-formed write");
        assert_eq!(bounds(), Some(rect(5, 5, 1, 1)));
    }

    #[test]
    fn a_write_spanning_tiles_lands_whole() {
        let _alone = alone();
        hold("p1", 256, 256);
        covered(rect(60, 60, 8, 8));

        assert_eq!(read(rect(60, 60, 8, 8)), vec![255u8; 64]);
        assert_eq!(bounds(), Some(rect(60, 60, 8, 8)));
        // Four tiles, because the run straddles both boundaries.
        assert_eq!(state().held.grid.tile_count(), 4);
    }

    #[test]
    fn nothing_outside_the_page_is_ever_selected() {
        let _alone = alone();
        hold("p1", 8, 8);
        covered(rect(4, 4, 100, 100));
        assert_eq!(bounds(), Some(rect(4, 4, 4, 4)));
    }

    #[test]
    fn taking_coverage_away_pulls_the_edges_in() {
        let _alone = alone();
        hold("p1", 128, 128);
        covered(rect(10, 10, 10, 10));
        write(rect(10, 10, 10, 5), &[0u8; 50]).expect("a well-formed write");
        assert_eq!(bounds(), Some(rect(10, 15, 10, 5)));
    }

    #[test]
    fn emptying_the_mask_leaves_no_bounds_and_no_tiles() {
        let _alone = alone();
        hold("p1", 128, 128);
        covered(rect(10, 10, 4, 4));
        write(rect(10, 10, 4, 4), &[0u8; 16]).expect("a well-formed write");

        assert_eq!(bounds(), None);
        assert_eq!(state().held.grid.tile_count(), 0);
    }

    /// The bill this whole arrangement exists for. A page of 128 tiles selected
    /// whole is one block plus the pointers at it, not 128 blocks.
    #[test]
    fn selecting_everything_costs_one_block() {
        let _alone = alone();
        let side = TILE_SIZE * 8;
        hold("p1", side, side);
        select_all();

        assert_eq!(bounds(), Some(rect(0, 0, side, side)));
        assert_eq!(state().held.grid.tile_count(), 64);
        // One block for the page, and the record holds nothing because there was
        // nothing there before.
        assert_eq!(bytes_held(), 4 * 1024);
    }

    #[test]
    fn an_edge_tile_of_a_full_page_is_its_own() {
        let _alone = alone();
        hold("p1", TILE_SIZE + 4, TILE_SIZE);
        select_all();

        assert_eq!(read(rect(TILE_SIZE + 3, 0, 1, 1)), vec![255]);
        // Nothing past the page edge, even inside the tile that covers it.
        assert_eq!(
            state()
                .held
                .scan_bounds(rect(0, 0, TILE_SIZE * 2, TILE_SIZE)),
            Some(rect(0, 0, TILE_SIZE + 4, TILE_SIZE))
        );
    }

    #[test]
    fn inverting_turns_every_value_over() {
        let _alone = alone();
        hold("p1", 4, 1);
        write(rect(0, 0, 4, 1), &[0, 128, 255, 1]).expect("a well-formed write");
        invert();
        assert_eq!(read(rect(0, 0, 4, 1)), vec![255, 127, 0, 254]);
    }

    #[test]
    fn inverting_everything_selects_nothing() {
        let _alone = alone();
        hold("p1", 128, 128);
        select_all();
        invert();
        assert_eq!(bounds(), None);
        assert_eq!(state().held.grid.tile_count(), 0);
    }

    #[test]
    fn inverting_nothing_selects_the_page() {
        let _alone = alone();
        hold("p1", 100, 60);
        invert();
        assert_eq!(bounds(), Some(rect(0, 0, 100, 60)));
    }

    #[test]
    fn a_write_is_taken_back_and_put_back_by_the_same_swap() {
        let _alone = alone();
        hold("p1", 128, 128);
        let name = covered(rect(10, 10, 4, 4));

        apply_journal(&name);
        assert_eq!(bounds(), None);
        assert_eq!(read(rect(10, 10, 1, 1)), vec![0]);

        apply_journal(&name);
        assert_eq!(bounds(), Some(rect(10, 10, 4, 4)));
        assert_eq!(read(rect(10, 10, 1, 1)), vec![255]);
    }

    #[test]
    fn deselecting_is_taken_back_whole() {
        let _alone = alone();
        hold("p1", 128, 128);
        covered(rect(10, 10, 4, 4));
        let name = deselect();

        assert_eq!(page(), None);
        assert_eq!(bounds(), None);

        apply_journal(&name);
        assert_eq!(page(), Some("p1".to_string()));
        assert_eq!(bounds(), Some(rect(10, 10, 4, 4)));
        assert_eq!(read(rect(10, 10, 1, 1)), vec![255]);
    }

    /// Which page a selection is for swaps with its bytes, so undoing back
    /// across a page is one step rather than a case somebody has to remember.
    #[test]
    fn selecting_on_another_page_is_taken_back_page_and_all() {
        let _alone = alone();
        hold("p1", 128, 128);
        covered(rect(10, 10, 4, 4));
        let name = hold("p2", 64, 64);
        covered(rect(0, 0, 2, 2));

        apply_journal(&name);
        assert_eq!(page(), Some("p1".to_string()));
        assert_eq!(size(), (128, 128));
        assert_eq!(bounds(), Some(rect(10, 10, 4, 4)));
    }

    #[test]
    fn selecting_everything_is_taken_back() {
        let _alone = alone();
        hold("p1", TILE_SIZE * 4, TILE_SIZE * 4);
        covered(rect(0, 0, 2, 2));
        let name = select_all();
        assert_eq!(bounds(), Some(rect(0, 0, TILE_SIZE * 4, TILE_SIZE * 4)));

        apply_journal(&name);
        assert_eq!(bounds(), Some(rect(0, 0, 2, 2)));
    }

    /// The number the whole arrangement is for. Sixteen tiles of page, selected
    /// whole and then taken back, and history is holding one block rather than
    /// sixteen — at the largest page that is the difference between 275 KB and
    /// 139 MB.
    #[test]
    fn history_holds_one_block_for_a_page_selected_whole() {
        let _alone = alone();
        let side = TILE_SIZE * 4;
        hold("p1", side, side);
        let name = select_all();
        apply_journal(&name);

        // The record now holds the sixteen coordinates the page covers, every
        // one of them pointing at the same block.
        assert_eq!(bytes_held(), 4 * 1024);
        assert_eq!(bounds(), None);
    }

    #[test]
    fn a_record_nobody_holds_any_more_does_nothing() {
        let _alone = alone();
        hold("p1", 128, 128);
        let name = covered(rect(10, 10, 4, 4));
        drop_journal(&name);

        apply_journal(&name);
        assert_eq!(bounds(), Some(rect(10, 10, 4, 4)));
    }
}
