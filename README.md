<p align="center">
  <img src="build/icon.svg" alt="Shashoku" width="128">
</p>

# Shashoku 写植

[繁體中文](README.zh-TW.md)

A Photoshop-like desktop editor for cleaning, translating, and typesetting manga, inspired by the LabelPlus + PS workflow.

> [!CAUTION]
> Early development. The on-disk format is still changing, and older projects will not open after an upgrade.

## Current features

- [x] Typesetting
  - [x] Vertical text, vertical punctuation forms and rotation, stroke, custom font folders, style suggestions
  - [x] Text box scaling, rotation, and free transform
- [x] Canvas
  - [x] Layer tree and compositing, brush and eraser, pen pressure, undo and redo
  - [x] Selection tools, boolean operations, quick mask
- [x] Cleaning
  - [x] Fill selection, clear selection, copy to a new layer
  - [x] AI text removal (experimental)
- [x] Recognition and translation
  - [x] Bubble detection, OCR, source and translation side by side, LLM translation
- [x] Library
  - [x] Workspaces, project and page browsing, page ordering, drag-and-drop import
- [x] Import and export
  - [x] Image import and export
  - [ ] Layered PSD import and export
- [ ] Platforms
  - [ ] Windows
  - [ ] Linux

## Installation

### Nix

```bash
nix run github:Tsuyumi25/Shashoku
```

## Development

```bash
pnpm install
pnpm engine:build
pnpm sidecar:sync
pnpm dev
```

Model weights are not shipped with the app; each downloads itself the first time it is asked for.

## Tech Stack

- Electron + Vue 3 + TypeScript + Pinia + Tailwind
- Rust native addon ([napi-rs](https://github.com/napi-rs/napi-rs))
- Python sidecar ([uv](https://github.com/astral-sh/uv))

## Models

- [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) — text and bubble detection
- [mayocream/koharu-layout-rfdetr-seg-2xl-1152](https://huggingface.co/mayocream/koharu-layout-rfdetr-seg-2xl-1152) — layout detection
- [kha-white/manga-ocr-base](https://huggingface.co/kha-white/manga-ocr-base) — Japanese OCR
- [genshiai-daichi/baberu-ocr](https://huggingface.co/genshiai-daichi/baberu-ocr) — OCR
- [JustANormalTinkerer/hayai-ocr-v2](https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2) — OCR
- [RapidOCR](https://github.com/RapidAI/RapidOCR) — OCR
- [fffonion/yuzumarker-font-detection](https://huggingface.co/fffonion/yuzumarker-font-detection) — font recognition
- [dreMaz/AnimeMangaInpainting](https://huggingface.co/dreMaz/AnimeMangaInpainting) — inpainting

## Inspiration

- [LabelPlus](https://github.com/LabelPlus/LabelPlus)
- [koharu](https://github.com/mayocream/koharu)
- [Krita](https://github.com/KDE/krita)
- [GIMP](https://github.com/GNOME/gimp)
- [darkly](https://github.com/darkly-art/darkly)

## License

[GPL-3.0-only](LICENSE)
