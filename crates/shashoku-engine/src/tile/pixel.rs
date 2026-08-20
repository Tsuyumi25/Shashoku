use std::marker::PhantomData;

use super::{TILE_AREA, TILE_SIZE};

/// What one pixel is made of.
///
/// There is one raster format today and one mask format, and a third is
/// unlikely — but the byte count stays behind this trait rather than being
/// welded into every signature, so that sixteen-bit or CMYK tiles would be a
/// new impl instead of a rewrite of everything that touches a tile.
///
/// `Send + Sync` is a real requirement rather than a formality: a flush takes
/// `Arc` snapshots of tiles and encodes them on another thread.
pub trait PixelFormat: Copy + Send + Sync + 'static {
    /// Bytes in one pixel.
    const CHANNELS: usize;

    /// Which of those bytes carries the alpha.
    const ALPHA_CHANNEL: usize;

    /// For messages and for tests that want to say which format failed.
    const NAME: &'static str;

    /// What one tile of this format weighs.
    const TILE_BYTES: usize = TILE_AREA * Self::CHANNELS;
}

/// Eight-bit RGBA, straight alpha — what a raster layer is made of. 16 KiB a
/// tile.
#[derive(Clone, Copy, Debug)]
pub struct Rgba8;

impl PixelFormat for Rgba8 {
    const CHANNELS: usize = 4;
    const ALPHA_CHANNEL: usize = 3;
    const NAME: &'static str = "RGBA8";
}

/// Eight-bit coverage, which is what a mask is. 4 KiB a tile.
#[derive(Clone, Copy, Debug)]
pub struct Alpha8;

impl PixelFormat for Alpha8 {
    const CHANNELS: usize = 1;
    const ALPHA_CHANNEL: usize = 0;
    const NAME: &'static str = "A8";
}

/// One tile's pixels.
///
/// Immutable once it is in a grid: a reader clones the `Arc` and reads, a
/// writer takes a private copy and swaps the pointer. Deliberately not
/// `Arc<Mutex<Tile>>` — a snapshot taken for encoding or compositing on another
/// thread must never wait on a lock a stroke in progress is holding, and that
/// hash-table contention is what Krita spent years unwinding.
#[derive(Clone)]
pub struct Tile<P: PixelFormat> {
    bytes: Box<[u8]>,
    format: PhantomData<P>,
}

impl<P: PixelFormat> Tile<P> {
    /// Every byte zero, which is what this format spells transparent.
    pub fn blank() -> Self {
        Self {
            bytes: vec![0u8; P::TILE_BYTES].into_boxed_slice(),
            format: PhantomData,
        }
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn bytes_mut(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    /// What this tile actually occupies, which is what history is metered by.
    pub fn byte_len(&self) -> usize {
        self.bytes.len()
    }

    /// One pixel, as its own channels rather than as a fixed array.
    pub fn pixel(&self, x: usize, y: usize) -> &[u8] {
        let at = Self::offset(x, y);
        &self.bytes[at..at + P::CHANNELS]
    }

    pub fn pixel_mut(&mut self, x: usize, y: usize) -> &mut [u8] {
        let at = Self::offset(x, y);
        &mut self.bytes[at..at + P::CHANNELS]
    }

    fn offset(x: usize, y: usize) -> usize {
        debug_assert!(x < TILE_SIZE as usize && y < TILE_SIZE as usize);
        (y * TILE_SIZE as usize + x) * P::CHANNELS
    }

    /// Every byte zero — the one spelling of empty.
    pub fn is_blank(&self) -> bool {
        self.bytes.iter().all(|&b| b == 0)
    }

    /// Strips the colour from every pixel whose alpha is zero, and reports
    /// whether anything survived.
    ///
    /// Not tidiness. Under straight alpha a fully transparent pixel can carry
    /// colour that nothing shows — until something resamples it, at which point
    /// bilinear filtering averages the neighbours' colour without consulting
    /// their alpha, and a transparent red drags the white beside it pink.
    /// Baking a transform takes exactly that path.
    ///
    /// Because a surviving pixel is one with a non-zero alpha, "blank" after
    /// this pass is the same statement as "all four bytes are zero".
    pub(super) fn normalize(&mut self) -> bool {
        let mut blank = true;
        for pixel in self.bytes.chunks_exact_mut(P::CHANNELS) {
            if pixel[P::ALPHA_CHANNEL] == 0 {
                pixel.fill(0);
            } else {
                blank = false;
            }
        }
        blank
    }
}

impl<P: PixelFormat> Default for Tile<P> {
    fn default() -> Self {
        Self::blank()
    }
}

/// By content, not by pointer. Two tiles that share a block are equal, and so
/// are two that merely happen to hold the same pixels — `Arc::ptr_eq` is what
/// asks the other question, and both get asked.
impl<P: PixelFormat> PartialEq for Tile<P> {
    fn eq(&self, other: &Self) -> bool {
        self.bytes == other.bytes
    }
}

impl<P: PixelFormat> Eq for Tile<P> {}

impl<P: PixelFormat> std::fmt::Debug for Tile<P> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tile")
            .field("format", &P::NAME)
            .field("bytes", &self.bytes.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_formats_weigh_what_the_spec_says() {
        assert_eq!(Rgba8::TILE_BYTES, 16 * 1024);
        assert_eq!(Alpha8::TILE_BYTES, 4 * 1024);
        assert_eq!(Tile::<Rgba8>::blank().byte_len(), 16 * 1024);
        assert_eq!(Tile::<Alpha8>::blank().byte_len(), 4 * 1024);
    }

    #[test]
    fn a_fresh_tile_is_blank() {
        assert!(Tile::<Rgba8>::blank().is_blank());
        assert!(Tile::<Alpha8>::blank().is_blank());
    }

    #[test]
    fn a_pixel_is_addressed_by_its_channels_not_by_a_fixed_array() {
        let mut rgba = Tile::<Rgba8>::blank();
        rgba.pixel_mut(3, 2).copy_from_slice(&[10, 20, 30, 40]);
        assert_eq!(rgba.pixel(3, 2), &[10, 20, 30, 40]);
        assert_eq!(rgba.pixel(2, 3), &[0, 0, 0, 0]);

        let mut mask = Tile::<Alpha8>::blank();
        mask.pixel_mut(3, 2).copy_from_slice(&[200]);
        assert_eq!(mask.pixel(3, 2), &[200]);
        assert_eq!(mask.pixel(2, 3), &[0]);
    }

    #[test]
    fn zeroing_an_alpha_takes_the_colour_with_it() {
        let mut tile = Tile::<Rgba8>::blank();
        tile.pixel_mut(0, 0).copy_from_slice(&[255, 0, 0, 0]);
        tile.pixel_mut(1, 0).copy_from_slice(&[0, 0, 255, 255]);

        assert!(!tile.normalize());
        assert_eq!(tile.pixel(0, 0), &[0, 0, 0, 0]);
        assert_eq!(tile.pixel(1, 0), &[0, 0, 255, 255]);
    }

    #[test]
    fn a_tile_of_transparent_colour_normalizes_to_blank() {
        let mut tile = Tile::<Rgba8>::blank();
        for x in 0..8 {
            tile.pixel_mut(x, 0).copy_from_slice(&[255, 0, 0, 0]);
        }
        assert!(tile.normalize());
        assert!(tile.is_blank());
    }

    #[test]
    fn a_mask_normalizes_by_the_same_rule_with_nothing_to_strip() {
        let mut mask = Tile::<Alpha8>::blank();
        assert!(mask.normalize());
        mask.pixel_mut(5, 5).copy_from_slice(&[1]);
        assert!(!mask.normalize());
        assert_eq!(mask.pixel(5, 5), &[1]);
    }
}
