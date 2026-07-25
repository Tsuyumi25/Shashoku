use std::fs::File;
use std::path::{Path, PathBuf};

use memmap2::Mmap;
use skrifa::{FontRef, MetadataProvider, string::StringId};

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
fn choose_localized<'a>(entries: &[(Option<String>, &'a str)], locales: &[String]) -> Option<&'a str> {
    for wanted in locales {
        let wanted = wanted.to_ascii_lowercase();
        for (language, value) in entries {
            let Some(language) = language else { continue };
            if language.to_ascii_lowercase().starts_with(&wanted) {
                return Some(value);
            }
        }
    }
    for (language, value) in entries {
        if language
            .as_deref()
            .is_some_and(|l| l.to_ascii_lowercase().starts_with("en"))
        {
            return Some(value);
        }
    }
    entries.first().map(|(_, value)| *value)
}

fn localized_entries(font: &FontRef, id: StringId) -> Vec<(Option<String>, String)> {
    font.localized_strings(id)
        .map(|s| {
            (
                s.language().map(|l| l.to_string()),
                s.chars().collect::<String>(),
            )
        })
        .collect()
}

fn name_for(font: &FontRef, ids: &[StringId], locales: &[String]) -> Option<String> {
    for id in ids {
        let owned = localized_entries(font, *id);
        if owned.is_empty() {
            continue;
        }
        let borrowed: Vec<(Option<String>, &str)> = owned
            .iter()
            .map(|(language, value)| (language.clone(), value.as_str()))
            .collect();
        if let Some(picked) = choose_localized(&borrowed, locales) {
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
    let Some(path_text) = path.to_str() else { return };

    let mut face_index = 0u32;
    while let Ok(font) = FontRef::from_index(&map, face_index) {
        // A face with no usable family name has nothing a picker could list.
        if let Some(family) = name_for(&font, &FAMILY_IDS, &[]) {
            let display_name =
                name_for(&font, &FAMILY_IDS, locales).unwrap_or_else(|| family.clone());
            out.push(FaceInfo {
                family,
                display_name,
                style: name_for(&font, &STYLE_IDS, &[]).unwrap_or_default(),
                postscript_name: name_for(&font, &[StringId::POSTSCRIPT_NAME], &[])
                    .unwrap_or_default(),
                path: path_text.to_string(),
                face_index,
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
        let Some(open_end) = rest.find('>') else { break };
        let attributes = &rest[..open_end];
        // "<directory>" or similar would match "<dir" too.
        if !attributes.is_empty() && !attributes.starts_with([' ', '\t', '\n', '\r', '/']) {
            continue;
        }
        rest = &rest[open_end + 1..];
        let Some(close) = rest.find("</dir>") else { break };
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
        let names = entries(&[(Some("ja-JP"), "源ノ角ゴシック"), (Some("zh-Hant-TW"), "思源黑體")]);
        let locales = vec!["ja".to_string(), "zh-Hant".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("源ノ角ゴシック"));
    }

    #[test]
    fn a_simplified_name_does_not_satisfy_a_traditional_request() {
        let names = entries(&[(Some("zh-Hans-CN"), "思源黑体"), (Some("en-US"), "Source Han Sans")]);
        let locales = vec!["zh-Hant".to_string()];
        assert_eq!(choose_localized(&names, &locales), Some("Source Han Sans"));
    }

    #[test]
    fn english_answers_when_no_locale_matches() {
        let names = entries(&[(Some("ja-JP"), "源ノ角ゴシック"), (Some("en-GB"), "Source Han Sans")]);
        assert_eq!(choose_localized(&names, &["ko".to_string()]), Some("Source Han Sans"));
    }

    #[test]
    fn an_english_only_font_needs_no_locale_at_all() {
        let names = entries(&[(Some("en-US"), "DejaVu Sans")]);
        assert_eq!(choose_localized(&names, &[]), Some("DejaVu Sans"));
    }

    #[test]
    fn a_font_naming_no_language_still_yields_its_name() {
        let names = entries(&[(None, "王漢宗中明體")]);
        assert_eq!(choose_localized(&names, &["zh-Hant".to_string()]), Some("王漢宗中明體"));
    }

    #[test]
    fn nameless_fonts_are_skipped() {
        assert_eq!(choose_localized(&[], &["zh-Hant".to_string()]), None);
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
