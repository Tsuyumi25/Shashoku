//! How a character stands in a column: CSS Writing Modes 3's
//! `text-orientation: mixed`, read off each character's UTR #50
//! Vertical_Orientation property:
//!
//! - U and Tu stand upright and are shaped with the face's `vert`.
//! - R is always set as in a row and turned a quarter clockwise — whatever the
//!   face's `vert` says. Shaped as a row, a face's joins still happen:
//!   GenYoGothic's `ccmp` makes `——` one two-em dash, and turned, one line.
//! - Tr stands upright when the face draws its vertical presentation form or
//!   its `vert` replaces it, and is turned otherwise.
//!
//! A face with no `vert` at all is put onto the presentation forms by the
//! shaper itself; they are never swapped in here. Doing more than this table —
//! swapping a form into a face whose `vert` left a character out on purpose —
//! is what set GenYoGothic's `！` off centre and broke its `——` in two.

/// How a character in a column is taken in hand when it is not plain upright.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Orientation {
    /// UTR #50 R: always turned.
    Rotated,
    /// UTR #50 Tr: upright if the face can stand it up, turned if not.
    Transformed,
}

/// From VerticalOrientation-18.0.0.txt, for the punctuation and symbols
/// lettering meets: general punctuation, CJK symbols, katakana's prolonged
/// sound mark, the low and over lines among the CJK compatibility forms, and
/// the fullwidth forms. Letters and digits are left out on purpose — whether a
/// Latin word in a balloon lies on its side is a typesetter's decision, not a
/// fallback — and so are arrows and the halfwidth katakana, which would turn in
/// a way nobody setting a column expects.
const ROTATED: &[(u32, u32)] = &[
    (0x2010, 0x2015),
    (0x2017, 0x2017),
    (0x201A, 0x201B),
    (0x201E, 0x201F),
    (0x2022, 0x2027),
    (0x2032, 0x203A),
    (0x203D, 0x2041),
    (0x2043, 0x2046),
    (0x204A, 0x2050),
    (0x2052, 0x205E),
    (0xFE49, 0xFE4F),
    (0xFF0D, 0xFF0D),
    (0xFF1C, 0xFF1E),
];

const TRANSFORMED: &[(u32, u32)] = &[
    (0x2018, 0x2019),
    (0x201C, 0x201D),
    (0x3008, 0x3011),
    (0x3014, 0x301F),
    (0x3030, 0x3030),
    (0x30A0, 0x30A0),
    (0x30FC, 0x30FC),
    (0xFF08, 0xFF09),
    (0xFF1A, 0xFF1B),
    (0xFF3B, 0xFF3B),
    (0xFF3D, 0xFF3D),
    (0xFF3F, 0xFF3F),
    (0xFF5B, 0xFF60),
    (0xFFE3, 0xFFE3),
];

fn within(table: &[(u32, u32)], c: char) -> bool {
    let c = c as u32;
    table.iter().any(|&(lo, hi)| (lo..=hi).contains(&c))
}

pub fn orientation(c: char) -> Option<Orientation> {
    if within(ROTATED, c) {
        Some(Orientation::Rotated)
    } else if within(TRANSFORMED, c) {
        Some(Orientation::Transformed)
    } else {
        None
    }
}

/// The vertical presentation form of a Tr character, by Unicode's `<vertical>`
/// decompositions with the fullwidth forms standing for their narrow sources.
/// Only asked whether the face draws it, never drawn in its place.
pub fn presentation_form(c: char) -> Option<char> {
    let form = match c {
        '\u{3008}' => '\u{FE3F}',
        '\u{3009}' => '\u{FE40}',
        '\u{300A}' => '\u{FE3D}',
        '\u{300B}' => '\u{FE3E}',
        '\u{300C}' => '\u{FE41}',
        '\u{300D}' => '\u{FE42}',
        '\u{300E}' => '\u{FE43}',
        '\u{300F}' => '\u{FE44}',
        '\u{3010}' => '\u{FE3B}',
        '\u{3011}' => '\u{FE3C}',
        '\u{3014}' => '\u{FE39}',
        '\u{3015}' => '\u{FE3A}',
        '\u{3016}' => '\u{FE17}',
        '\u{3017}' => '\u{FE18}',
        '\u{FF08}' => '\u{FE35}',
        '\u{FF09}' => '\u{FE36}',
        '\u{FF1A}' => '\u{FE13}',
        '\u{FF1B}' => '\u{FE14}',
        '\u{FF3B}' => '\u{FE47}',
        '\u{FF3D}' => '\u{FE48}',
        '\u{FF3F}' => '\u{FE33}',
        '\u{FF5B}' => '\u{FE37}',
        '\u{FF5D}' => '\u{FE38}',
        _ => return None,
    };
    Some(form)
}

/// Whether anything in `text` is more than plain upright — the common case is
/// a column with none, which is shaped whole.
pub fn may_need_help(text: &str) -> bool {
    text.chars().any(|c| orientation(c).is_some())
}
