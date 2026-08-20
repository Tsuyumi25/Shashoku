use std::sync::Arc;

use super::TileCoord;
use super::grid::TileGrid;
use super::pixel::{PixelFormat, Tile};

/// What one transaction wrote over: a vector of "this coordinate held this".
///
/// Applying it swaps — the grid takes what the journal held, the journal takes
/// what the grid held. Swapping is an involution, so undo and redo are the same
/// code path and only one copy of anything is ever stored.
///
/// A before-and-after pair would store two, and metering it would then have to
/// walk both sides and deduplicate by pointer to answer what history actually
/// occupies. Storing the difference instead saves 12–15%, not half: the
/// expensive side is what was already on the layer, and mixing it with the new
/// pixels yields something just as hard to compress.
pub struct TileJournal<P: PixelFormat> {
    entries: Vec<(TileCoord, Option<Arc<Tile<P>>>)>,
}

impl<P: PixelFormat> TileJournal<P> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Which coordinates this journal speaks for.
    pub fn coords(&self) -> impl Iterator<Item = TileCoord> + '_ {
        self.entries.iter().map(|(coord, _)| *coord)
    }

    /// The distinct tiles this journal is holding onto, by pointer.
    ///
    /// One block shared by ten thousand coordinates is one tile here, which is
    /// the only way the count can be right: a select-all mask is tens of
    /// thousands of coordinates pointing at a single block, and counting each
    /// coordinate's bytes would report hundreds of megabytes for four kilobytes
    /// of memory.
    pub fn distinct_tiles(&self) -> impl Iterator<Item = &Arc<Tile<P>>> {
        let mut seen: Vec<*const Tile<P>> = Vec::new();
        self.entries.iter().filter_map(move |(_, held)| {
            let tile = held.as_ref()?;
            let at = Arc::as_ptr(tile);
            if seen.contains(&at) {
                return None;
            }
            seen.push(at);
            Some(tile)
        })
    }

    pub(super) fn push(&mut self, coord: TileCoord, held: Option<Arc<Tile<P>>>) {
        self.entries.push((coord, held));
    }

    /// Swaps this journal's contents with the grid's, leaving the journal
    /// holding what the grid held. Applying it a second time puts everything
    /// back, which is why undo and redo need no separate implementation.
    pub fn apply(&mut self, grid: &mut TileGrid<P>) {
        for (coord, held) in &mut self.entries {
            *held = grid.swap(*coord, held.take());
        }
    }
}

impl<P: PixelFormat> Default for TileJournal<P> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Alpha8, Rgba8, TILE_SIZE};
    use super::*;

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];

    fn paint(grid: &mut TileGrid<Rgba8>, x: i32, y: i32, value: &[u8]) -> TileJournal<Rgba8> {
        let mut tx = grid.transaction();
        tx.set_pixel(x, y, value);
        tx.commit()
    }

    #[test]
    fn a_journal_names_the_tiles_the_transaction_touched() {
        let mut grid = TileGrid::<Rgba8>::new();
        let mut tx = grid.transaction();
        tx.set_pixel(0, 0, &RED);
        tx.set_pixel(TILE_SIZE, 0, &BLUE);
        let journal = tx.commit();

        let mut coords: Vec<TileCoord> = journal.coords().collect();
        coords.sort();
        assert_eq!(coords, vec![TileCoord::new(0, 0), TileCoord::new(1, 0)]);
    }

    #[test]
    fn a_tile_touched_twice_is_recorded_once_as_it_stood_first() {
        let mut grid = TileGrid::<Rgba8>::new();
        drop(paint(&mut grid, 0, 0, &RED));

        let mut journal = {
            let mut tx = grid.transaction();
            tx.set_pixel(1, 0, &BLUE);
            tx.set_pixel(2, 0, &BLUE);
            tx.commit()
        };

        assert_eq!(journal.len(), 1);
        journal.apply(&mut grid);
        assert_eq!(grid.pixel(1, 0), Some(&[0, 0, 0, 0][..]));
        assert_eq!(grid.pixel(2, 0), Some(&[0, 0, 0, 0][..]));
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
    }

    #[test]
    fn applying_once_undoes_and_applying_twice_redoes() {
        let mut grid = TileGrid::<Rgba8>::new();
        drop(paint(&mut grid, 0, 0, &RED));
        let mut journal = paint(&mut grid, 1, 0, &BLUE);

        journal.apply(&mut grid);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
        assert_eq!(grid.pixel(1, 0), Some(&[0, 0, 0, 0][..]));

        journal.apply(&mut grid);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
        assert_eq!(grid.pixel(1, 0), Some(&BLUE[..]));
    }

    #[test]
    fn undoing_the_first_write_to_a_tile_takes_the_tile_away_again() {
        let mut grid = TileGrid::<Rgba8>::new();
        let mut journal = paint(&mut grid, 0, 0, &RED);
        assert_eq!(grid.tile_count(), 1);

        journal.apply(&mut grid);
        assert_eq!(grid.tile_count(), 0);

        journal.apply(&mut grid);
        assert_eq!(grid.tile_count(), 1);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
    }

    #[test]
    fn a_journal_from_a_grown_grid_survives_the_round_trip() {
        let mut grid = TileGrid::<Rgba8>::new();
        drop(paint(&mut grid, 0, 0, &RED));
        let mut journal = paint(&mut grid, -1, -1, &BLUE);

        assert_eq!(grid.origin(), TileCoord::new(-1, -1));

        journal.apply(&mut grid);
        assert_eq!(grid.pixel(-1, -1), None);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
        // The ground stays claimed; only the tile went. The layer's own frame
        // is restored by the command that holds this journal, not by the grid.
        assert_eq!(grid.origin(), TileCoord::new(-1, -1));

        journal.apply(&mut grid);
        assert_eq!(grid.pixel(-1, -1), Some(&BLUE[..]));
    }

    #[test]
    fn an_empty_journal_moves_nothing_however_often_it_is_applied() {
        let mut grid = TileGrid::<Rgba8>::new();
        drop(paint(&mut grid, 0, 0, &RED));

        let mut journal = TileJournal::<Rgba8>::new();
        journal.apply(&mut grid);
        journal.apply(&mut grid);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
    }

    #[test]
    fn one_block_shared_by_many_coordinates_is_counted_once() {
        let mut grid = TileGrid::<Rgba8>::new();
        let solid = Arc::new({
            let mut tile = Tile::<Rgba8>::blank();
            tile.bytes_mut()
                .chunks_exact_mut(4)
                .for_each(|p| p.copy_from_slice(&RED));
            tile
        });
        {
            let mut tx = grid.transaction();
            for at in 0..100 {
                tx.hang(TileCoord::new(at, 0), Arc::clone(&solid));
            }
            drop(tx.commit());
        }

        // Writing over all hundred of them records all hundred coordinates,
        // every one of which held the same block.
        let journal = {
            let mut tx = grid.transaction();
            for at in 0..100 {
                tx.clear(TileCoord::new(at, 0));
            }
            tx.commit()
        };

        assert_eq!(journal.len(), 100);
        let held: usize = journal.distinct_tiles().map(|tile| tile.byte_len()).sum();
        assert_eq!(held, 16 * 1024);
    }

    #[test]
    fn a_mask_journal_swaps_the_same_way() {
        let mut grid = TileGrid::<Alpha8>::new();
        let mut journal = {
            let mut tx = grid.transaction();
            tx.set_pixel(5, 5, &[200]);
            tx.commit()
        };

        journal.apply(&mut grid);
        assert_eq!(grid.pixel(5, 5), None);
        journal.apply(&mut grid);
        assert_eq!(grid.pixel(5, 5), Some(&[200][..]));
    }
}
