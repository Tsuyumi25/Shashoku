"""去字(inpainting)——分層策略:balloon-fill 快速路徑 + LaMa-manga ONNX 兜底。

管線(演算法對齊 comic-translate / koharu,代碼自寫):
  1. mask:框內 Otsu 雙極性(黑字+白字都取)→ 連通元件過濾(小雜訊剔除、
     碰裁切邊界的元件剔除——排除穿過框的氣泡邊線)→ 按框尺寸比例膨脹。
  2. Tier 0 balloon-fill:文字周邊背景取中位數色,各通道 std 夠低(純色氣泡)
     就直接填色,跳過模型。
  3. Tier 1 LaMa-manga(ONNX,CPU):其餘框裁 context margin 跑模型,
     只取回 mask 內的像素。
  4. 回傳 RGBA 補丁(mask 外 alpha=0),app 端貼進獨立「去字」圖層,可擦回。

Tier 2(擴散級,SFX 壓在畫上的硬 case)刻意不在此:先由使用者既有的
ComfyUI 流程處理,等 Tier 0/1 進 app 驗完形狀再決定接法。
"""

import base64
import io
import time

import cv2
import numpy as np
from PIL import Image

INPAINT_REPO = "ogkalu/lama-manga-onnx-dynamic"
INPAINT_FILE = "lama-manga-dynamic.onnx"

MASK_PAD = 5  # mask 偵測區 = 框外擴 5px(同 comic-translate default_padding)
CONTEXT_PAD = 64  # LaMa 的 context 裁切邊距
MIN_AREA = 10  # 連通元件最小面積
SMALL_MIN_AREA = 4  # 小元件(標點)下限
SMALL_MAX_SPAN = 6  # 小元件最大邊長
BORDER_MARGIN = 1  # 碰到裁切邊界(1px 內)的元件剔除
# balloon-fill 用穩健統計而非 std:背景樣本會被「穿過裁切區的氣泡邊線」污染
# (邊線元件正確地不進 mask,但會留在背景樣本裡),std 對這種離群值過敏。
BG_UNIFORM_TOLERANCE = 12.0  # 與中位數色的最大通道偏差視為「同色」的界線
BG_UNIFORM_FRACTION = 0.95  # 同色像素佔比達此值 → 純色背景(網點/漸層過不了)
PAD_MOD = 8  # LaMa 空間對齊


class LamaInpainter:
    """LaMa-manga ONNX 的薄封裝,惰性下載/載入。"""

    def __init__(self):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(INPAINT_REPO, INPAINT_FILE)
        so = ort.SessionOptions()
        so.log_severity_level = 3
        self.session = ort.InferenceSession(
            path, sess_options=so, providers=["CPUExecutionProvider"]
        )
        names = [i.name for i in self.session.get_inputs()]
        self.image_input, self.mask_input = names[0], names[1]

    def forward(self, image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """image_rgb: (H,W,3) uint8;mask: (H,W) uint8 0/255。回傳同尺寸 RGB uint8。"""
        h, w = mask.shape
        ph = (PAD_MOD - h % PAD_MOD) % PAD_MOD
        pw = (PAD_MOD - w % PAD_MOD) % PAD_MOD
        img = cv2.copyMakeBorder(image_rgb, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        msk = cv2.copyMakeBorder(mask, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=0)

        img_t = (img.astype(np.float32) / 255.0).transpose(2, 0, 1)[np.newaxis]
        msk_t = (msk > 0).astype(np.float32)[np.newaxis, np.newaxis]
        out = self.session.run(None, {self.image_input: img_t, self.mask_input: msk_t})[0]
        res = np.clip(out[0].transpose(1, 2, 0) * 255, 0, 255).astype(np.uint8)
        return res[:h, :w]


def _component_filter(binary: np.ndarray) -> np.ndarray:
    """連通元件過濾:保留 (面積>MIN_AREA 或 標點級小元件) 且不碰裁切邊界者。"""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n <= 1:
        return np.zeros(binary.shape, dtype=np.uint8)
    h, w = binary.shape
    keep = np.zeros(n, dtype=bool)
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        big = area > MIN_AREA
        small_ok = area >= SMALL_MIN_AREA and cw <= SMALL_MAX_SPAN and ch <= SMALL_MAX_SPAN
        inside = (
            x >= BORDER_MARGIN
            and y >= BORDER_MARGIN
            and x + cw <= w - BORDER_MARGIN
            and y + ch <= h - BORDER_MARGIN
        )
        keep[i] = (big or small_ok) and inside
    return np.where(keep[labels], 255, 0).astype(np.uint8)


def build_text_mask(crop_rgb: np.ndarray, block_w: int, block_h: int) -> np.ndarray:
    """框內筆畫 mask:Otsu 雙極性 + 元件過濾 + 按框尺寸比例膨脹。回傳 0/255。"""
    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    thr, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    black = (gray < thr).astype(np.uint8)
    white = (gray > thr).astype(np.uint8)

    mask = np.maximum(_component_filter(black), _component_filter(white))
    if not mask.any():
        return mask

    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    # 膨脹半徑跟著框的短邊走(近似 koharu 的字級比例),夾在 2..6。
    iterations = int(np.clip(round(min(block_w, block_h) * 0.03), 2, 6))
    return cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=iterations)


def try_balloon_fill(crop_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray | None:
    """Tier 0:mask 外的背景若是純色,以中位數色填 mask。否則 None。"""
    bg = crop_rgb[mask == 0].astype(np.float32)
    if bg.shape[0] < 32:
        return None
    med = np.median(bg, axis=0)
    close = np.abs(bg - med).max(axis=1) <= BG_UNIFORM_TOLERANCE
    if float(close.mean()) < BG_UNIFORM_FRACTION:
        return None
    out = crop_rgb.copy()
    out[mask > 0] = med.astype(np.uint8)
    return out


def _clamp_rect(x: int, y: int, w: int, h: int, img_w: int, img_h: int):
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(img_w, x + w)
    y1 = min(img_h, y + h)
    return x0, y0, max(0, x1 - x0), max(0, y1 - y0)


def _encode_patch_png(rgb: np.ndarray, mask: np.ndarray) -> str:
    """組 RGBA 補丁(mask 外 alpha=0)→ PNG → base64。"""
    rgba = np.dstack([rgb, mask])
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def inpaint_blocks(image_path: str, blocks: list[dict], get_lama, log) -> dict:
    """對一頁的多個框去字。get_lama() 惰性取得 LamaInpainter(未用到就不載模型)。

    回傳 {"patches": [{x,y,w,h,method,png}]},座標為 mask 偵測區(原圖 px)。
    """
    img = np.asarray(Image.open(image_path).convert("RGB"))
    img_h, img_w = img.shape[:2]
    patches = []
    t_total = time.time()
    n_fill = n_lama = 0

    for b in blocks:
        # mask 偵測區:框 + MASK_PAD
        mx, my, mw, mh = _clamp_rect(
            b["x"] - MASK_PAD, b["y"] - MASK_PAD,
            b["w"] + MASK_PAD * 2, b["h"] + MASK_PAD * 2, img_w, img_h,
        )
        if mw < 8 or mh < 8:
            continue
        mask_crop = img[my : my + mh, mx : mx + mw]
        mask = build_text_mask(mask_crop, b["w"], b["h"])
        if not mask.any():
            continue

        filled = try_balloon_fill(mask_crop, mask)
        if filled is not None:
            n_fill += 1
            patches.append({
                "x": mx, "y": my, "w": mw, "h": mh,
                "method": "fill",
                "png": _encode_patch_png(filled, mask),
            })
            continue

        # Tier 1:LaMa。裁 context margin,mask 貼進對應位置。
        cx, cy, cw, ch = _clamp_rect(
            mx - CONTEXT_PAD, my - CONTEXT_PAD,
            mw + CONTEXT_PAD * 2, mh + CONTEXT_PAD * 2, img_w, img_h,
        )
        ctx_crop = img[cy : cy + ch, cx : cx + cw]
        ctx_mask = np.zeros((ch, cw), dtype=np.uint8)
        ctx_mask[my - cy : my - cy + mh, mx - cx : mx - cx + mw] = mask

        t = time.time()
        result = get_lama().forward(ctx_crop, ctx_mask)
        log(f"  lama {cw}x{ch}: {(time.time()-t)*1000:.0f}ms")
        n_lama += 1

        # 只取回 mask 區的像素,回傳 mask 偵測區大小的補丁。
        out = ctx_crop.copy()
        out[ctx_mask > 0] = result[ctx_mask > 0]
        sub = out[my - cy : my - cy + mh, mx - cx : mx - cx + mw]
        patches.append({
            "x": mx, "y": my, "w": mw, "h": mh,
            "method": "lama",
            "png": _encode_patch_png(sub, mask),
        })

    log(
        f"inpaint: {len(patches)} patches (fill={n_fill}, lama={n_lama}), "
        f"{(time.time()-t_total)*1000:.0f}ms"
    )
    return {"patches": patches}
