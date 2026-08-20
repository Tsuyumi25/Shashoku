//! Tiled pixel storage.
//!
//! How a raster layer's pixels are held in memory, how a write to them is
//! recorded, and how that recording is undone. Nothing here reaches the
//! filesystem or JavaScript — a layer on disk is one PNG, and the tile is the
//! unit of memory, dirtiness, drawing and undo, which is a different question.

mod grid;
mod journal;
mod pixel;

pub use grid::{TileEdit, TileGrid, TileTransaction};
pub use journal::TileJournal;
pub use pixel::{Alpha8, PixelFormat, Rgba8, Tile};

/// Tiles are square, and this is the side in pixels.
///
/// The number follows the backend rather than the convention. These tiles are
/// read and written by the CPU, where small means less waste around the edge of
/// a patch: a 300×200 balloon patch costs about twice its own area at 64 and
/// four to six times at 256. A GPU-surface tile wants the opposite, because
/// there the cost being saved is the draw call.
pub const TILE_SIZE: i32 = 64;

/// Pixels in one tile.
pub const TILE_AREA: usize = (TILE_SIZE * TILE_SIZE) as usize;

/// Which tile a pixel belongs to, in layer-local coordinates.
///
/// A stable logical coordinate, never a position in the grid's `Vec`. History
/// holds these, and a layer that grows to the left inserts a column at the
/// front — were the coordinate an index, every record already taken would slide
/// onto the wrong tile. Silently, with the picture still looking right.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct TileCoord {
    pub tx: i32,
    pub ty: i32,
}

impl TileCoord {
    pub fn new(tx: i32, ty: i32) -> Self {
        Self { tx, ty }
    }
}

/// Which tile a layer-local pixel falls in, and where inside it.
///
/// Euclidean rather than truncating: Rust's `/` and `%` round toward zero, so
/// −1 would land in tile 0 beside +1 and the two halves of the grid would write
/// over each other.
pub fn tile_of(x: i32, y: i32) -> (TileCoord, usize, usize) {
    (
        TileCoord {
            tx: x.div_euclid(TILE_SIZE),
            ty: y.div_euclid(TILE_SIZE),
        },
        x.rem_euclid(TILE_SIZE) as usize,
        y.rem_euclid(TILE_SIZE) as usize,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pixel_and_its_tile_agree_on_the_origin() {
        assert_eq!(tile_of(0, 0), (TileCoord::new(0, 0), 0, 0));
        assert_eq!(tile_of(63, 63), (TileCoord::new(0, 0), 63, 63));
        assert_eq!(tile_of(64, 0), (TileCoord::new(1, 0), 0, 0));
        assert_eq!(tile_of(0, 64), (TileCoord::new(0, 1), 0, 0));
    }

    #[test]
    fn a_negative_pixel_lands_in_a_negative_tile_rather_than_beside_its_mirror() {
        // Truncating division would put both of these in tile 0.
        assert_eq!(tile_of(-1, -1), (TileCoord::new(-1, -1), 63, 63));
        assert_eq!(tile_of(1, 1), (TileCoord::new(0, 0), 1, 1));

        assert_eq!(tile_of(-64, -64), (TileCoord::new(-1, -1), 0, 0));
        assert_eq!(tile_of(-65, -65), (TileCoord::new(-2, -2), 63, 63));
    }
}
