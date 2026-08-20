use std::fs::File;
use std::path::{Path, PathBuf};

use memmap2::Mmap;
use read_fonts::{Offset, TableProvider};
use skrifa::{FontRef, MetadataProvider, attribute::Style, string::StringId};

pub struct FaceInfo {
    /// Locale-independent name, used as the family's identity. Display names
    /// follow the reader's language and so cannot be what a project file
    /// stores — the same project has to resolve to the same font elsewhere.
    pub family: String,
    /// Same family in the reader's language when the font carries one.
    pub display_name: String,
    pub style: String,
    pub postscript_name: String,
    pub path: String,
    pub face_index: u32,
    /// usWeightClass, nominally 1–1000 with 400 as regular. Read so a family's
    /// faces can be ordered by weight rather than by directory walk order.
    pub weight: f32,
    /// Width as a percentage of normal, 100 being normal. Derived from
    /// usWidthClass, which only has nine steps.
    pub width: f32,
    /// Degrees away from upright; 0 is upright. See `slant_degrees`.
    pub slant: f32,
}

/// CSS's default `font-style: oblique` angle, for faces that declare a slope
/// without saying how much.
const DEFAULT_SLANT_DEGREES: f32 = 14.0;

/// One number for the style axis so faces sort upright-first without the
/// caller having to know italic from oblique — the style string still carries
/// that distinction for anything that wants to show it.
fn slant_degrees(style: Style) -> f32 {
    match style {
        Style::Normal => 0.0,
        Style::Italic => DEFAULT_SLANT_DEGREES,
        Style::Oblique(angle) => angle.unwrap_or(DEFAULT_SLANT_DEGREES),
    }
}

const FONT_EXTENSIONS: [&str; 4] = ["ttf", "otf", "ttc", "otc"];

/// Font directories nest a level or two (`noto-cjk/`, `truetype/dejavu/`);
/// the bound is only there so a symlink cycle cannot spin forever.
const MAX_DEPTH: u32 = 8;

fn is_font_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            let lowered = ext.to_ascii_lowercase();
            FONT_EXTENSIONS.contains(&lowered.as_str())
        })
}

/// Picks the string whose language best matches `locales`, in the order given,
/// falling back to English and then to whatever came first.
///
/// A record that exists but is blank is passed over at every step. Fonts ship
/// them — hand-lettered CJK families routinely carry an empty Macintosh record
/// beside a correct Windows one — and its language is "en", so taking it would
/// leave a font with no name that the catalogue can key on.
fn choose_localized<'a>(
    entries: &[(Option<String>, &'a str)],
    locales: &[String],
) -> Option<&'a str> {
    let named = |value: &str| !value.trim().is_empty();

    for wanted in locales {
        let wanted = wanted.to_ascii_lowercase();
        for (language, value) in entries {
            let Some(language) = language else { continue };
            if language.to_ascii_lowercase().starts_with(&wanted) && named(value) {
                return Some(value);
            }
        }
    }
    for (language, value) in entries {
        if language
            .as_deref()
            .is_some_and(|l| l.to_ascii_lowercase().starts_with("en"))
            && named(value)
        {
            return Some(value);
        }
    }
    entries
        .iter()
        .find(|(_, value)| named(value))
        .map(|(_, value)| *value)
}

struct DecodedName {
    platform_rank: usize,
    plausible: bool,
    language: Option<String>,
    value: String,
}

/// Windows first: its records carry the localizations, and every one of them
/// is decodable. The Macintosh platform comes last because its non-Roman
/// charsets are not, and its Roman records are where a skipped Windows record
/// used to surface as mojibake. Three ranks cover everything, because
/// `decoded_entries` yields nothing for any other platform.
fn platform_rank(platform_id: u16) -> usize {
    match platform_id {
        3 => 0,
        0 => 1,
        _ => 2,
    }
}

const PLATFORM_RANKS: usize = 3;

fn decode_utf16_be(bytes: &[u8]) -> String {
    char::decode_utf16(
        bytes
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]])),
    )
    .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
    .collect()
}

/// Whether a decode produced text rather than wreckage. Nothing legitimate in
/// a name is a control character or a replacement character, so either one
/// says the bytes were not what the decoding assumed.
fn plausibly_decoded(value: &str) -> bool {
    !value
        .chars()
        .any(|c| c == char::REPLACEMENT_CHARACTER || c.is_control())
}

fn decoded_entries(font: &FontRef, id: StringId) -> Vec<DecodedName> {
    let Ok(name) = font.name() else {
        return Vec::new();
    };
    let data = name.string_data();
    // skrifa visits the same records in the same order, and zipping its
    // iterator in is the only public route to its language-id table.
    let languages = font
        .localized_strings(id)
        .map(|s| s.language().map(str::to_string));
    name.name_record()
        .iter()
        .filter(|record| record.name_id() == id)
        .zip(languages)
        .filter_map(|(record, language)| {
            let start = record.string_offset().non_null().unwrap_or(0);
            let bytes = data
                .as_bytes()
                .get(start..start + record.length() as usize)?;
            // All platform-3 strings are UTF-16BE — the encoding ID names a
            // character repertoire, not an encoding. read-fonts (and HarfBuzz)
            // decode only a shortlist of those IDs and hand back nothing for
            // the rest, which is how a font's real name got skipped for a
            // mojibake Macintosh fallback.
            let value = match (record.platform_id(), record.encoding_id()) {
                (0 | 3, _) => decode_utf16_be(bytes),
                (1, 0) => record.string(data).ok()?.chars().collect(),
                // Undecodable without per-charset tables (Macintosh Shift-JIS
                // and friends): one dependency for 0.5% of a real library.
                _ => return None,
            };
            Some(DecodedName {
                platform_rank: platform_rank(record.platform_id()),
                plausible: plausibly_decoded(&value),
                language,
                value,
            })
        })
        .collect()
}

fn borrowed<'a>(entries: &[&'a DecodedName]) -> Vec<(Option<String>, &'a str)> {
    entries
        .iter()
        .map(|e| (e.language.clone(), e.value.as_str()))
        .collect()
}

fn name_for(font: &FontRef, ids: &[StringId], locales: &[String]) -> Option<String> {
    for id in ids {
        let entries = decoded_entries(font, *id);
        // A name is resolved entirely within one platform before the next is
        // consulted: the platforms hold translations of the same name, so a
        // clean lower-priority record must not outrank a clean Windows one
        // merely by being English.
        for rank in 0..PLATFORM_RANKS {
            let group: Vec<&DecodedName> = entries
                .iter()
                .filter(|e| e.platform_rank == rank && e.plausible)
                .collect();
            if let Some(picked) = choose_localized(&borrowed(&group), locales) {
                return Some(picked.to_string());
            }
        }
        // Every record decoded to wreckage. A wrong-looking name still names
        // the face better than dropping it from the catalogue.
        let mut leftovers: Vec<&DecodedName> = entries.iter().filter(|e| !e.plausible).collect();
        leftovers.sort_by_key(|e| e.platform_rank);
        if let Some(picked) = choose_localized(&borrowed(&leftovers), locales) {
            return Some(picked.to_string());
        }
    }
    None
}

/// Typographic family first: it is the name that groups every weight of a
/// family together, while the legacy field splits them once a family has more
/// than the four styles the old model allowed.
const FAMILY_IDS: [StringId; 2] = [StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME];
const STYLE_IDS: [StringId; 2] = [
    StringId::TYPOGRAPHIC_SUBFAMILY_NAME,
    StringId::SUBFAMILY_NAME,
];

fn read_faces(path: &Path, locales: &[String], out: &mut Vec<FaceInfo>) {
    let Ok(file) = File::open(path) else { return };
    // SAFETY: same reasoning as rendering — an installed font file is
    // effectively immutable, and the parser bounds-checks every offset.
    let Ok(map) = (unsafe { Mmap::map(&file) }) else {
        return;
    };
    let Some(path_text) = path.to_str() else {
        return;
    };

    let mut face_index = 0u32;
    while let Ok(font) = FontRef::from_index(&map, face_index) {
        // A face with no usable family name has nothing a picker could list.
        if let Some(family) = name_for(&font, &FAMILY_IDS, &[]) {
            let display_name =
                name_for(&font, &FAMILY_IDS, locales).unwrap_or_else(|| family.clone());
            let attributes = font.attributes();
            out.push(FaceInfo {
                family,
                display_name,
                style: name_for(&font, &STYLE_IDS, &[]).unwrap_or_default(),
                postscript_name: name_for(&font, &[StringId::POSTSCRIPT_NAME], &[])
                    .unwrap_or_default(),
                path: path_text.to_string(),
                face_index,
                weight: attributes.weight.value(),
                width: attributes.stretch.percentage(),
                slant: slant_degrees(attributes.style),
            });
        }
        face_index += 1;
    }
}

fn walk(dir: &Path, depth: u32, locales: &[String], out: &mut Vec<FaceInfo>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = dir.read_dir() else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => walk(&path, depth + 1, locales, out),
            _ if is_font_file(&path) => read_faces(&path, locales, out),
            _ => {}
        }
    }
}

pub fn scan(dirs: &[PathBuf], locales: &[String]) -> Vec<FaceInfo> {
    let mut out = Vec::new();
    for dir in dirs {
        walk(dir, 0, locales, &mut out);
    }
    out
}

/// Pulls the `<dir>` elements out of a fontconfig config file, keeping each
/// one's `prefix` attribute.
///
/// Deliberately not an XML parse: the only thing wanted here is a flat list of
/// directory elements, and a malformed file should cost us a directory rather
/// than the whole scan.
fn dirs_in_config(config: &str) -> Vec<(Option<String>, String)> {
    let mut found = Vec::new();
    let mut rest = config;
    while let Some(at) = rest.find("<dir") {
        rest = &rest[at + 4..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        let attributes = &rest[..open_end];
        // "<directory>" or similar would match "<dir" too.
        if !attributes.is_empty() && !attributes.starts_with([' ', '\t', '\n', '\r', '/']) {
            continue;
        }
        rest = &rest[open_end + 1..];
        let Some(close) = rest.find("</dir>") else {
            break;
        };
        let value = rest[..close].trim();
        rest = &rest[close + 6..];
        if value.is_empty() {
            continue;
        }
        let prefix = attributes
            .split_once("prefix=")
            .map(|(_, tail)| tail.trim_start_matches(['"', '\'']))
            .and_then(|tail| tail.split(['"', '\'']).next())
            .map(str::to_string);
        found.push((prefix, value.to_string()));
    }
    found
}

fn xdg_data_home() -> Option<PathBuf> {
    match std::env::var_os("XDG_DATA_HOME") {
        Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => home_relative(".local/share"),
    }
}

fn resolve_config_dir(prefix: Option<&str>, value: &str) -> Option<PathBuf> {
    if prefix == Some("xdg") {
        return xdg_data_home().map(|base| base.join(value));
    }
    match value.strip_prefix("~/") {
        Some(tail) => home_relative(tail),
        None => Some(PathBuf::from(value)),
    }
}

/// Directories fontconfig has been told about. On distributions that keep
/// fonts outside the conventional paths — NixOS scatters every package under
/// /nix/store — this is the only way to find them.
fn fontconfig_dirs() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = vec![PathBuf::from("/etc/fonts/fonts.conf")];
    if let Ok(entries) = Path::new("/etc/fonts/conf.d").read_dir() {
        files.extend(
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|ext| ext == "conf")),
        );
    }
    files.extend(home_relative(".config/fontconfig/fonts.conf"));

    let mut dirs = Vec::new();
    for file in files {
        let Ok(config) = std::fs::read_to_string(&file) else {
            continue;
        };
        for (prefix, value) in dirs_in_config(&config) {
            dirs.extend(resolve_config_dir(prefix.as_deref(), &value));
        }
    }
    dirs
}

fn home_relative(suffix: &str) -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join(suffix))
}

pub fn default_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        dirs.push(PathBuf::from("/Library/Fonts"));
        dirs.extend(home_relative("Library/Fonts"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            dirs.push(PathBuf::from(windir).join("Fonts"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        dirs.extend(home_relative(".local/share/fonts"));
        dirs.extend(home_relative(".fonts"));
        dirs.extend(fontconfig_dirs());
    }

    dirs.retain(|dir| dir.is_dir());
    // Configured directories overlap and nest; scanning a file twice would
    // list the same family twice.
    dirs.sort();
    dirs.dedup();
    let nested = dirs.clone();
    dirs.retain(|dir| {
        !nested
            .iter()
            .any(|other| other != dir && dir.starts_with(other))
    });
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries<'a>(pairs: &[(Option<&'a str>, &'a str)]) -> Vec<(Option<String>, &'a str)> {
        pairs
            .iter()
            .map(|(language, value)| (language.map(str::to_string), *value))
            .collect()
    }

    #[test]
    fn the_first_matching_locale_wins() {
        let names = entries(&[
            (Some("en-US"), "Source Han Sans"),
            (Some("zh-Hant-TW"), "思源黑體"),
            (Some("ja-JP"), "源ノ角ゴシック"),
        ]);
        let locales = vec!["zh-Hant".to_string(), "en".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("思源黑體"));
    }

    #[test]
    fn locale_preference_is_ordered_not_merely_matched() {
        let names = entries(&[
            (Some("ja-JP"), "源ノ角ゴシック"),
            (Some("zh-Hant-TW"), "思源黑體"),
        ]);
        let locales = vec!["ja".to_string(), "zh-Hant".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("源ノ角ゴシック"));
    }

    #[test]
    fn a_simplified_name_does_not_satisfy_a_traditional_request() {
        let names = entries(&[
            (Some("zh-Hans-CN"), "思源黑体"),
            (Some("en-US"), "Source Han Sans"),
        ]);
        let locales = vec!["zh-Hant".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("Source Han Sans"));
    }

    #[test]
    fn english_answers_when_no_locale_matches() {
        let names = entries(&[
            (Some("ja-JP"), "源ノ角ゴシック"),
            (Some("en-GB"), "Source Han Sans"),
        ]);
        assert_eq!(
            choose_localized(&names, &["ko".to_string()]),
            Some("Source Han Sans")
        );
    }

    #[test]
    fn an_english_only_font_needs_no_locale_at_all() {
        let names = entries(&[(Some("en-US"), "DejaVu Sans")]);
        assert_eq!(choose_localized(&names, &[]), Some("DejaVu Sans"));
    }

    #[test]
    fn a_font_naming_no_language_still_yields_its_name() {
        let names = entries(&[(None, "王漢宗中明體")]);
        assert_eq!(
            choose_localized(&names, &["zh-Hant".to_string()]),
            Some("王漢宗中明體")
        );
    }

    /**
     * Hand-lettered CJK families routinely ship an empty Macintosh record
     * beside a correct Windows one. Its language is "en", so the English
     * fallback used to select it and hand back a family with no name — which
     * then collapsed every such font onto one blank entry in the catalogue.
     */
    #[test]
    fn a_blank_record_is_not_a_name() {
        let names = entries(&[(Some("en"), ""), (Some("en"), "章草")]);
        assert_eq!(choose_localized(&names, &[]), Some("章草"));
    }

    #[test]
    fn a_blank_record_does_not_win_on_its_locale_either() {
        let names = entries(&[(Some("zh-Hant-TW"), "  "), (Some("en-US"), "Some Face")]);
        let locales = vec!["zh-Hant".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("Some Face"));
    }

    #[test]
    fn a_blank_record_does_not_answer_as_the_last_resort() {
        let names = entries(&[(None, ""), (None, "王漢宗中明體")]);
        assert_eq!(choose_localized(&names, &[]), Some("王漢宗中明體"));
    }

    #[test]
    fn a_face_whose_records_are_all_blank_has_no_name_at_all() {
        let names = entries(&[(Some("en"), ""), (None, "   ")]);
        assert_eq!(choose_localized(&names, &[]), None);
    }

    #[test]
    fn nameless_fonts_are_skipped() {
        assert_eq!(choose_localized(&[], &["zh-Hant".to_string()]), None);
    }

    #[test]
    fn utf16be_decodes_the_basic_plane_and_surrogate_pairs() {
        assert_eq!(decode_utf16_be(&[0x00, 0x41, 0x4E, 0x9F]), "A亟");
        assert_eq!(decode_utf16_be(&[0xD8, 0x3D, 0xDE, 0x00]), "😀");
    }

    #[test]
    fn a_lone_surrogate_becomes_a_replacement_character() {
        assert_eq!(decode_utf16_be(&[0xD8, 0x3D]), "\u{FFFD}");
    }

    #[test]
    fn clean_text_is_plausible_in_any_script() {
        assert!(plausibly_decoded("SourceHanSansTC-Bold"));
        assert!(plausibly_decoded("源ノ角ゴシック"));
    }

    #[test]
    fn wreckage_is_not_plausible() {
        assert!(!plausibly_decoded("源ノ\u{FFFD}ゴシック"));
        assert!(!plausibly_decoded("源ノ\u{0002}ゴシック"));
    }

    #[test]
    fn windows_outranks_unicode_outranks_macintosh() {
        assert!(platform_rank(3) < platform_rank(0));
        assert!(platform_rank(0) < platform_rank(1));
    }

    #[test]
    fn upright_is_zero_and_a_declared_angle_survives() {
        assert_eq!(slant_degrees(Style::Normal), 0.0);
        assert_eq!(slant_degrees(Style::Oblique(Some(-9.4))), -9.4);
    }

    #[test]
    fn a_slope_with_no_angle_still_reads_as_slanted() {
        assert_ne!(slant_degrees(Style::Italic), 0.0);
        assert_ne!(slant_degrees(Style::Oblique(None)), 0.0);
    }

    #[test]
    fn collections_and_plain_fonts_both_count_as_font_files() {
        for name in ["a.ttf", "b.OTF", "c.ttc", "d.otc"] {
            assert!(is_font_file(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn non_font_files_are_ignored() {
        for name in ["fonts.dir", "README", "a.ttf.bak", "a.pfb"] {
            assert!(!is_font_file(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn config_directories_are_read_with_their_prefix() {
        let config = r#"
            <fontconfig>
              <dir>/nix/store/abc-noto-fonts</dir>
              <dir prefix="xdg">fonts</dir>
              <dir>~/.fonts</dir>
            </fontconfig>
        "#;
        assert_eq!(
            dirs_in_config(config),
            vec![
                (None, "/nix/store/abc-noto-fonts".to_string()),
                (Some("xdg".to_string()), "fonts".to_string()),
                (None, "~/.fonts".to_string()),
            ]
        );
    }

    #[test]
    fn other_elements_are_left_alone() {
        let config = r#"
            <fontconfig>
              <cachedir>/var/cache/fontconfig</cachedir>
              <include ignore_missing="yes">conf.d</include>
              <dir>/usr/share/fonts</dir>
            </fontconfig>
        "#;
        assert_eq!(
            dirs_in_config(config),
            vec![(None, "/usr/share/fonts".to_string())]
        );
    }

    #[test]
    fn a_config_without_directories_yields_none() {
        assert!(dirs_in_config("<fontconfig><match/></fontconfig>").is_empty());
    }

    #[test]
    fn a_truncated_element_does_not_take_the_rest_with_it() {
        let config = "<dir>/usr/share/fonts</dir><dir>/half";
        assert_eq!(
            dirs_in_config(config),
            vec![(None, "/usr/share/fonts".to_string())]
        );
    }
}
