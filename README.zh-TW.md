# Shashoku 写植

[English](README.md)

專為漫畫去字、翻譯、嵌字的類 Photoshop 桌面編輯器，受 LabelPlus + PS 工作流啟發。

> [!CAUTION]
> 早期開發。磁碟格式還會變，升級之後舊專案會打不開。

## 目前的功能

- [x] 嵌字
  - [x] 直排、標點的直排異體與旋轉、描邊、自訂字型目錄、樣式推薦
  - [x] 文字框縮放、旋轉、變形
- [x] 畫布
  - [x] 圖層樹與合成、筆刷與橡皮擦、壓感、撤銷與重做
  - [x] 選區工具、布林運算、快速遮罩
- [x] 去字
  - [x] 填滿選區、清除選區內容、拷貝成新圖層
  - [x] AI 去字（試作）
- [x] 辨識與翻譯
  - [x] 對話框偵測、OCR、原文與譯文對照、LLM 翻譯
- [x] 書庫
  - [x] 工作區、專案與頁面瀏覽、頁面排序、拖曳匯入
- [x] 匯入與匯出
  - [x] 圖片匯入與匯出
  - [ ] 分層 PSD 匯入與匯出
- [ ] 平台
  - [ ] Windows
  - [ ] Linux

## 安裝

### Nix

```bash
nix run github:Tsuyumi25/Shashoku
```

## 開發

```bash
pnpm install
pnpm engine:build
pnpm sidecar:sync
pnpm dev
```

模型權重不隨程式出貨，第一次被叫到的時候各自下載。

## 技術棧

- Electron + Vue 3 + TypeScript + Pinia + Tailwind
- Rust native addon（[napi-rs](https://github.com/napi-rs/napi-rs)）
- Python sidecar（[uv](https://github.com/astral-sh/uv)）

## 使用的模型

- [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) — 文字與氣泡偵測
- [mayocream/koharu-layout-rfdetr-seg-2xl-1152](https://huggingface.co/mayocream/koharu-layout-rfdetr-seg-2xl-1152) — 版面偵測
- [kha-white/manga-ocr-base](https://huggingface.co/kha-white/manga-ocr-base) — 日文 OCR
- [genshiai-daichi/baberu-ocr](https://huggingface.co/genshiai-daichi/baberu-ocr) — OCR
- [JustANormalTinkerer/hayai-ocr-v2](https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2) — OCR
- [RapidOCR](https://github.com/RapidAI/RapidOCR) — OCR
- [fffonion/yuzumarker-font-detection](https://huggingface.co/fffonion/yuzumarker-font-detection) — 字體辨識
- [dreMaz/AnimeMangaInpainting](https://huggingface.co/dreMaz/AnimeMangaInpainting) — 修圖

## Inspiration

- [LabelPlus](https://github.com/LabelPlus/LabelPlus)
- [koharu](https://github.com/mayocream/koharu)
- [Krita](https://github.com/KDE/krita)
- [GIMP](https://github.com/GNOME/gimp)
- [darkly](https://github.com/darkly-art/darkly)

## 授權

[GPL-3.0-only](LICENSE)
