use std::collections::HashSet;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

use super::journal::TileJournal;
use super::pixel::{PixelFormat, Tile};
use super::{TileCoord, tile_of};

/// A layer's tiles, held densely and indexed by arithmetic.
///
/// The grid carries its own origin, which may be negative, and the index is
/// computed: `index = coordinate − origin`. Growing to the left moves the
/// origin and leaves every tile's coordinate exactly where it was, which is
/// what lets history hold coordinates rather than positions.
///
/// The origin is measured in tiles and lives only in memory. A layer's frame in
/// page pixels is a different number in a different unit, and it is the one the
/// manifest carries — on disk a layer is one PNG plus x/y/w/h, so the grid is
/// rebuilt from zero when a page is opened and a negative coordinate never
/// outlives the session that made it.
pub struct TileGrid<P: PixelFormat> {
    origin: TileCoord,
    cols: i32,
    rows: i32,
    tiles: Vec<Option<Arc<Tile<P>>>>,
}

impl<P: PixelFormat> TileGrid<P> {
    /// A grid holding nothing and claiming no ground. The first write decides
    /// where the origin is.
    pub fn new() -> Self {
        Self {
            origin: TileCoord::new(0, 0),
            cols: 0,
            rows: 0,
            tiles: Vec::new(),
        }
    }

    pub fn origin(&self) -> TileCoord {
        self.origin
    }

    pub fn cols(&self) -> i32 {
        self.cols
    }

    pub fn rows(&self) -> i32 {
        self.rows
    }

    /// Whether the coordinate is inside the ground the grid currently claims.
    /// Outside is not an error — it reads as transparent, and writing there
    /// grows the grid.
    pub fn holds(&self, coord: TileCoord) -> bool {
        coord.tx >= self.origin.tx
            && coord.tx < self.origin.tx + self.cols
            && coord.ty >= self.origin.ty
            && coord.ty < self.origin.ty + self.rows
    }

    /// The tile at a coordinate as a shared pointer — what a journal records
    /// and what a flush carries to another thread. `None` means transparent.
    pub fn tile(&self, coord: TileCoord) -> Option<Arc<Tile<P>>> {
        self.index_of(coord).and_then(|at| self.tiles[at].clone())
    }

    /// One pixel in layer-local coordinates. `None` where no tile stands, which
    /// is to say transparent.
    pub fn pixel(&self, x: i32, y: i32) -> Option<&[u8]> {
        let (coord, ix, iy) = tile_of(x, y);
        self.tile_ref(coord).map(|tile| tile.pixel(ix, iy))
    }

    /// Which coordinates hold a tile, in row-major order.
    ///
    /// The scratch layer is asked this at commit time — it is how a stroke says
    /// which tiles it touched without the target layer having to guess.
    pub fn occupied(&self) -> impl Iterator<Item = TileCoord> + '_ {
        let origin = self.origin;
        let cols = self.cols;
        self.tiles.iter().enumerate().filter_map(move |(at, slot)| {
            slot.as_ref()?;
            let at = at as i32;
            Some(TileCoord::new(origin.tx + at % cols, origin.ty + at / cols))
        })
    }

    /// How many tiles stand, which is the sparsity the `None` invariant exists
    /// to protect.
    pub fn tile_count(&self) -> usize {
        self.tiles.iter().filter(|slot| slot.is_some()).count()
    }

    /// Opens a transaction. Everything that writes goes through one, because a
    /// write that is not recorded cannot be undone.
    pub fn transaction(&mut self) -> TileTransaction<'_, P> {
        TileTransaction {
            grid: self,
            journal: TileJournal::new(),
            seen: HashSet::new(),
        }
    }

    fn index_of(&self, coord: TileCoord) -> Option<usize> {
        if !self.holds(coord) {
            return None;
        }
        let col = (coord.tx - self.origin.tx) as i64;
        let row = (coord.ty - self.origin.ty) as i64;
        Some((row * self.cols as i64 + col) as usize)
    }

    pub(super) fn tile_ref(&self, coord: TileCoord) -> Option<&Tile<P>> {
        self.index_of(coord)
            .and_then(|at| self.tiles[at].as_deref())
    }

    pub(super) fn slot_mut(&mut self, coord: TileCoord) -> &mut Option<Arc<Tile<P>>> {
        let at = self
            .index_of(coord)
            .expect("slot_mut is only reached after growing to hold the coordinate");
        &mut self.tiles[at]
    }

    /// Puts `held` at `coord` and hands back whatever was there.
    ///
    /// Growing for a `None` would claim ground to store nothing, so a swap that
    /// is transparent on both sides is left alone — outside the grid already
    /// reads as transparent.
    pub(super) fn swap(
        &mut self,
        coord: TileCoord,
        held: Option<Arc<Tile<P>>>,
    ) -> Option<Arc<Tile<P>>> {
        if held.is_none() && !self.holds(coord) {
            return None;
        }
        self.grow_to_hold(coord);
        std::mem::replace(self.slot_mut(coord), held)
    }

    /// Widens the grid until `coord` is inside it, moving the origin when the
    /// growth is toward the negative. Tiles keep their coordinates; only their
    /// positions in the `Vec` move.
    pub(super) fn grow_to_hold(&mut self, coord: TileCoord) {
        if self.holds(coord) {
            return;
        }
        if self.cols == 0 || self.rows == 0 {
            self.origin = coord;
            self.cols = 1;
            self.rows = 1;
            self.tiles = vec![None];
            return;
        }

        let origin = TileCoord::new(self.origin.tx.min(coord.tx), self.origin.ty.min(coord.ty));
        let cols = (self.origin.tx + self.cols).max(coord.tx + 1) - origin.tx;
        let rows = (self.origin.ty + self.rows).max(coord.ty + 1) - origin.ty;
        let area = usize::try_from(cols as i64 * rows as i64)
            .expect("a tile grid that large would not fit in memory anyway");

        let mut tiles: Vec<Option<Arc<Tile<P>>>> = vec![None; area];
        for row in 0..self.rows {
            for col in 0..self.cols {
                let from = (row as i64 * self.cols as i64 + col as i64) as usize;
                let Some(tile) = self.tiles[from].take() else {
                    continue;
                };
                let to_col = (self.origin.tx + col - origin.tx) as i64;
                let to_row = (self.origin.ty + row - origin.ty) as i64;
                tiles[(to_row * cols as i64 + to_col) as usize] = Some(tile);
            }
        }

        self.origin = origin;
        self.cols = cols;
        self.rows = rows;
        self.tiles = tiles;
    }
}

impl<P: PixelFormat> Default for TileGrid<P> {
    fn default() -> Self {
        Self::new()
    }
}

/// One transaction's worth of writing.
///
/// Records each tile as it stood the first time this transaction touches it,
/// and hands back the journal that puts it back. First record wins: a journal
/// is the state the transaction opened on, so a tile written twice must still
/// report what stood there before the first of the two writes.
pub struct TileTransaction<'a, P: PixelFormat> {
    grid: &'a mut TileGrid<P>,
    journal: TileJournal<P>,
    seen: HashSet<TileCoord>,
}

impl<P: PixelFormat> TileTransaction<'_, P> {
    /// Hands the tile over for writing, growing the grid and copying the tile
    /// out of whatever else shares it.
    pub fn edit(&mut self, coord: TileCoord) -> TileEdit<'_, P> {
        self.record(coord);
        self.grid.grow_to_hold(coord);
        let slot = self.grid.slot_mut(coord);
        if slot.is_none() {
            *slot = Some(Arc::new(Tile::blank()));
        }
        // A tile put here blank and then left alone would be a second spelling
        // of empty, so the guard settles either way.
        TileEdit {
            grid: self.grid,
            coord,
            touched: true,
        }
    }

    /// Puts a whole tile back to transparent.
    pub fn clear(&mut self, coord: TileCoord) {
        if self.grid.tile_ref(coord).is_none() {
            return;
        }
        self.record(coord);
        self.grid.swap(coord, None);
    }

    /// Hangs a ready-made tile at a coordinate, sharing it rather than copying
    /// it. This is how a fill points every interior tile of a covered run at
    /// one block.
    pub fn hang(&mut self, coord: TileCoord, tile: Arc<Tile<P>>) {
        self.record(coord);
        self.grid.swap(coord, Some(tile));
    }

    /// Writes one pixel in layer-local coordinates.
    pub fn set_pixel(&mut self, x: i32, y: i32, value: &[u8]) {
        let (coord, ix, iy) = tile_of(x, y);
        self.edit(coord).pixel_mut(ix, iy).copy_from_slice(value);
    }

    /// The grid as it stands mid-transaction, for reading back what has been
    /// written so far — compositing a stroke needs what is already on the layer
    /// under it.
    pub fn grid(&self) -> &TileGrid<P> {
        self.grid
    }

    /// The journal that undoes everything this transaction did.
    pub fn commit(self) -> TileJournal<P> {
        self.journal
    }

    fn record(&mut self, coord: TileCoord) {
        if !self.seen.insert(coord) {
            return;
        }
        self.journal.push(coord, self.grid.tile(coord));
    }
}

/// A tile handed over for writing.
///
/// The grid's invariants are restored when this is dropped: a pixel whose alpha
/// the write took to zero loses its colour with it, and a tile left holding
/// nothing becomes `None` rather than a `Some` full of zeroes.
///
/// Enforced here rather than asked of callers, because "empty" having two
/// spellings is how a session that opens 90% `None` closes 90% `Some`-full-of-
/// nothing, with the sparsity the whole layout rests on gone and no single
/// commit to blame.
pub struct TileEdit<'a, P: PixelFormat> {
    grid: &'a mut TileGrid<P>,
    coord: TileCoord,
    touched: bool,
}

impl<P: PixelFormat> Deref for TileEdit<'_, P> {
    type Target = Tile<P>;

    fn deref(&self) -> &Tile<P> {
        self.grid
            .tile_ref(self.coord)
            .expect("an edit puts a tile there before handing it over")
    }
}

impl<P: PixelFormat> DerefMut for TileEdit<'_, P> {
    fn deref_mut(&mut self) -> &mut Tile<P> {
        self.touched = true;
        // The copy in copy-on-write, and the only place it happens: `make_mut`
        // clones when the pointer is shared and hands it over directly when it
        // is not, so a tile nobody else holds is written in place.
        Arc::make_mut(
            self.grid
                .slot_mut(self.coord)
                .as_mut()
                .expect("an edit puts a tile there before handing it over"),
        )
    }
}

impl<P: PixelFormat> Drop for TileEdit<'_, P> {
    fn drop(&mut self) {
        if !self.touched {
            return;
        }
        let slot = self.grid.slot_mut(self.coord);
        let Some(tile) = slot.as_mut() else { return };
        if Arc::make_mut(tile).normalize() {
            *slot = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Alpha8, Rgba8, TILE_SIZE};
    use super::*;

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];

    fn write(grid: &mut TileGrid<Rgba8>, x: i32, y: i32, value: &[u8]) {
        let mut tx = grid.transaction();
        tx.set_pixel(x, y, value);
        drop(tx.commit());
    }

    #[test]
    fn a_fresh_grid_claims_no_ground() {
        let grid = TileGrid::<Rgba8>::new();
        assert_eq!(grid.cols(), 0);
        assert_eq!(grid.rows(), 0);
        assert!(!grid.holds(TileCoord::new(0, 0)));
        assert_eq!(grid.tile(TileCoord::new(0, 0)), None);
        assert_eq!(grid.pixel(0, 0), None);
    }

    #[test]
    fn the_first_write_decides_where_the_origin_is() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 130, 200, &RED);
        assert_eq!(grid.origin(), TileCoord::new(2, 3));
        assert_eq!((grid.cols(), grid.rows()), (1, 1));
        assert_eq!(grid.pixel(130, 200), Some(&RED[..]));
    }

    #[test]
    fn one_tile_holds_sixty_four_pixels_each_way() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);
        write(&mut grid, 63, 63, &BLUE);
        assert_eq!(grid.tile_count(), 1);

        write(&mut grid, 64, 0, &RED);
        assert_eq!(grid.tile_count(), 2);
    }

    #[test]
    fn growing_toward_the_negative_moves_the_origin_and_keeps_every_coordinate() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);
        assert_eq!(grid.origin(), TileCoord::new(0, 0));

        write(&mut grid, -1, -1, &BLUE);

        assert_eq!(grid.origin(), TileCoord::new(-1, -1));
        assert_eq!((grid.cols(), grid.rows()), (2, 2));
        // The tile written first is still at the coordinate it was written at,
        // even though its position in the Vec has moved.
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
        assert_eq!(grid.pixel(-1, -1), Some(&BLUE[..]));
        assert_eq!(grid.tile_count(), 2);
    }

    #[test]
    fn growing_far_to_the_negative_leaves_the_ground_between_empty() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);
        write(&mut grid, -3 * TILE_SIZE, 0, &BLUE);

        assert_eq!(grid.origin(), TileCoord::new(-3, 0));
        assert_eq!((grid.cols(), grid.rows()), (4, 1));
        assert_eq!(grid.tile_count(), 2);
        assert_eq!(grid.pixel(-TILE_SIZE, 0), None);
        assert_eq!(grid.pixel(0, 0), Some(&RED[..]));
        assert_eq!(grid.pixel(-3 * TILE_SIZE, 0), Some(&BLUE[..]));
    }

    #[test]
    fn a_write_of_transparent_colour_leaves_no_tile_at_all() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &[255, 0, 0, 0]);
        assert_eq!(grid.tile_count(), 0);
        assert_eq!(grid.tile(TileCoord::new(0, 0)), None);
    }

    #[test]
    fn taking_a_pixels_alpha_to_zero_takes_its_colour_too() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);
        write(&mut grid, 1, 0, &BLUE);

        write(&mut grid, 0, 0, &[255, 0, 0, 0]);

        assert_eq!(grid.pixel(0, 0), Some(&[0, 0, 0, 0][..]));
        assert_eq!(grid.pixel(1, 0), Some(&BLUE[..]));
    }

    #[test]
    fn erasing_the_last_pixel_of_a_tile_drops_the_tile() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);
        assert_eq!(grid.tile_count(), 1);

        write(&mut grid, 0, 0, &[0, 0, 0, 0]);
        assert_eq!(grid.tile_count(), 0);
    }

    #[test]
    fn a_tile_taken_hold_of_and_not_written_leaves_nothing_behind() {
        let mut grid = TileGrid::<Rgba8>::new();
        {
            let mut tx = grid.transaction();
            drop(tx.edit(TileCoord::new(4, 4)));
            drop(tx.commit());
        }
        assert_eq!(grid.tile_count(), 0);
    }

    #[test]
    fn a_shared_tile_splits_when_one_holder_writes() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);

        let snapshot = grid
            .tile(TileCoord::new(0, 0))
            .expect("a tile stands there");
        write(&mut grid, 1, 0, &BLUE);
        let after = grid
            .tile(TileCoord::new(0, 0))
            .expect("a tile stands there");

        assert!(!Arc::ptr_eq(&snapshot, &after));
        assert_eq!(snapshot.pixel(1, 0), &[0, 0, 0, 0]);
        assert_eq!(after.pixel(1, 0), &BLUE[..]);
    }

    #[test]
    fn a_tile_is_copied_once_a_transaction_however_often_it_is_written() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, 0, 0, &RED);

        let at = TileCoord::new(0, 0);
        let mut tx = grid.transaction();

        // The first write copies, and must: recording what stood there before
        // took a second pointer to it, so the block is genuinely shared.
        tx.set_pixel(1, 0, &BLUE);
        let after_first = Arc::as_ptr(&tx.grid().tile(at).expect("a tile"));

        // Every write after that goes into the copy the first one made, which
        // is what keeps a fill of one tile from copying it four thousand times.
        for x in 2..64 {
            tx.set_pixel(x, 0, &BLUE);
        }
        let after_many = Arc::as_ptr(&tx.grid().tile(at).expect("a tile"));

        assert_eq!(after_first, after_many);
        assert_eq!(tx.commit().len(), 1);
    }

    #[test]
    fn many_coordinates_can_point_at_one_block() {
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
            for tx_at in 0..8 {
                tx.hang(TileCoord::new(tx_at, 0), Arc::clone(&solid));
            }
            drop(tx.commit());
        }

        assert_eq!(grid.tile_count(), 8);
        assert_eq!(Arc::strong_count(&solid), 9);
        let first = grid.tile(TileCoord::new(0, 0)).expect("a tile");
        let last = grid.tile(TileCoord::new(7, 0)).expect("a tile");
        assert!(Arc::ptr_eq(&first, &last));
    }

    #[test]
    fn clearing_a_tile_that_was_never_there_does_nothing() {
        let mut grid = TileGrid::<Rgba8>::new();
        let mut tx = grid.transaction();
        tx.clear(TileCoord::new(9, 9));
        let journal = tx.commit();
        assert!(journal.is_empty());
        assert_eq!(grid.cols(), 0);
    }

    #[test]
    fn occupied_names_every_coordinate_that_holds_a_tile() {
        let mut grid = TileGrid::<Rgba8>::new();
        write(&mut grid, -TILE_SIZE, 0, &RED);
        write(&mut grid, TILE_SIZE, TILE_SIZE, &BLUE);

        let mut held: Vec<TileCoord> = grid.occupied().collect();
        held.sort();
        assert_eq!(held, vec![TileCoord::new(-1, 0), TileCoord::new(1, 1)]);
    }

    #[test]
    fn a_mask_grows_and_shares_by_the_same_machinery() {
        let mut grid = TileGrid::<Alpha8>::new();
        {
            let mut tx = grid.transaction();
            tx.set_pixel(0, 0, &[255]);
            tx.set_pixel(-1, -1, &[128]);
            drop(tx.commit());
        }

        assert_eq!(grid.origin(), TileCoord::new(-1, -1));
        assert_eq!(grid.pixel(0, 0), Some(&[255][..]));
        assert_eq!(grid.pixel(-1, -1), Some(&[128][..]));

        let snapshot = grid.tile(TileCoord::new(0, 0)).expect("a tile");
        {
            let mut tx = grid.transaction();
            tx.set_pixel(1, 0, &[64]);
            drop(tx.commit());
        }
        assert!(!Arc::ptr_eq(
            &snapshot,
            &grid.tile(TileCoord::new(0, 0)).expect("a tile")
        ));
        assert_eq!(snapshot.byte_len(), 4 * 1024);
    }

    #[test]
    fn a_mask_write_of_zero_leaves_no_tile() {
        let mut grid = TileGrid::<Alpha8>::new();
        let mut tx = grid.transaction();
        tx.set_pixel(0, 0, &[0]);
        drop(tx.commit());
        assert_eq!(grid.tile_count(), 0);
    }
}
