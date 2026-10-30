//! What a character does in a column when the face has no vertical form for it.
//!
//! A face says how its characters stand in vertical text through its `vert`
//! feature, and many leave characters out — four in ten of a working library
//! of CJK faces have no vertical `…`. Two ways on remain, both what Firefox
//! does (gfxTextRun.cpp, gfxHarfBuzzShaper.cpp): the Unicode vertical
//! presentation form, when the face draws one, and otherwise turning the
//! character a quarter clockwise, which is what UTR #50 says a character
//! marked R or Tr is for.
//!
//! ⚠️ Only for characters that would otherwise lie wrong — R and Tr. A Tu
//! character (`、。，！？`) set upright as it is still reads correctly, and a
//! face with a `vert` that leaves one out usually meant it: GenYoGothic JP
//! keeps `！？` upright, and its `︕︖` stand a fifth of an em right of the
//! column's centre. Firefox reaches the presentation forms only for a face
//! with no `vert` at all, which the shaper already handles by itself.

/// UTR #50 R and Tr, from VerticalOrientation-18.0.0.txt, for the punctuation
/// and symbols lettering meets: general punctuation, CJK symbols, katakana's
/// prolonged sound mark, the low and over lines among the CJK compatibility
/// forms, and the fullwidth forms. Letters and digits are left
/// out on purpose — whether a Latin word in a balloon lies on its side is a
/// typesetter's decision, not a fallback — and so are arrows and the halfwidth
/// katakana, which would turn in a way nobody setting a column expects.
const TURNS: &[(u32, u32)] = &[
    (0x2010, 0x2015),
    (0x2017, 0x2017),
    (0x2018, 0x2019),
    (0x201A, 0x201B),
    (0x201C, 0x201D),
    (0x201E, 0x201F),
    (0x2022, 0x2027),
    (0x2032, 0x203A),
    (0x203D, 0x2041),
    (0x2043, 0x2046),
    (0x204A, 0x2050),
    (0x2052, 0x205E),
    (0x3008, 0x3011),
    (0x3014, 0x301F),
    (0x3030, 0x3030),
    (0x30A0, 0x30A0),
    (0x30FC, 0x30FC),
    (0xFE49, 0xFE4F),
    (0xFF08, 0xFF09),
    (0xFF0D, 0xFF0D),
    (0xFF1A, 0xFF1E),
    (0xFF3B, 0xFF3B),
    (0xFF3D, 0xFF3D),
    (0xFF3F, 0xFF3F),
    (0xFF5B, 0xFF60),
    (0xFFE3, 0xFFE3),
];

/// Whether `c` lies on its side in a column the face has no form for.
pub fn turns(c: char) -> bool {
    let c = c as u32;
    TURNS.iter().any(|&(lo, hi)| (lo..=hi).contains(&c))
}

/// The vertical presentation form of a character that turns, as Firefox's
/// table pairs them.
pub fn presentation_form(c: char) -> Option<char> {
    let form = match c {
        '\u{2013}' => '\u{FE32}',
        '\u{2014}' => '\u{FE31}',
        '\u{2025}' => '\u{FE30}',
        '\u{2026}' => '\u{FE19}',
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
        '\u{FE4F}' => '\u{FE34}',
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

/// Whether anything in `text` could need either way on — the common case is
/// a column with none, which is shaped whole as it always was.
pub fn may_need_help(text: &str) -> bool {
    text.chars().any(turns)
}
