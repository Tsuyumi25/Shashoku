"""Shashoku OCR sidecar——偵測 + 辨識的獨立 Python 進程。

管線:RT-DETR-v2 ONNX(ogkalu/comic-text-and-bubble-detector,INT8)找出
氣泡/文字框 → manga-ocr 讀每個文字框的原文。CPU 就跑得動(小模型);
之後要換 PaddleOCR-VL-For-Manga(需 ROCm GPU)時,只動這支、協議不變。

協議:stdin/stdout 各一行一個 JSON;所有 log 走 stderr,stdout 只吐協議。
  → {"id":1,"cmd":"detect_ocr","image":"/abs/path.jpg"}
  ← {"id":1,"ok":true,"width":W,"height":H,"blocks":[{x,y,w,h,label,score,text}]}
  無 id 的事件行:{"event":"loading","detail":...} / {"event":"ready"}

單獨測試:python sidecar.py --once /path/img.jpg [--annotate out.png]
"""

import os

# 進 import 前就關掉 HF 進度條,避免任何東西污染 stdout。
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

import argparse
import json
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

DETECTOR_REPO = "ogkalu/comic-text-and-bubble-detector"
DETECTOR_FILE = "detector-v4-s_int8.onnx"
# RT-DETR 輸出的類別語義(上游 model 的既定事實)
LABELS = {0: "bubble", 1: "text_bubble", 2: "text_free"}
TEXT_LABELS = {"text_bubble", "text_free"}
CONF_THRESHOLD = 0.3
OCR_PAD_RATIO = 0.05  # OCR 前框外擴 5%,避免貼邊裁掉筆畫


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Detector:
    """RT-DETR-v2 ONNX。前處理:640×640 / 255 / CHW;模型吃原尺寸、直接輸出原圖座標。"""

    def __init__(self):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(DETECTOR_REPO, DETECTOR_FILE)
        so = ort.SessionOptions()
        so.log_severity_level = 3
        so.intra_op_num_threads = 4
        so.inter_op_num_threads = 1
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            path, sess_options=so, providers=["CPUExecutionProvider"]
        )

    def detect(self, img: Image.Image) -> list[dict]:
        arr = np.asarray(img.resize((640, 640)), dtype=np.float32) / 255.0
        arr = arr.transpose(2, 0, 1)[np.newaxis, ...]
        orig = np.array([[img.width, img.height]], dtype=np.int64)

        labels, boxes, scores = self.session.run(
            None, {"images": arr, "orig_target_sizes": orig}
        )[:3]
        if labels.ndim == 2:
            labels, boxes, scores = labels[0], boxes[0], scores[0]

        out = []
        for lab, box, scr in zip(labels, boxes, scores):
            if float(scr) < CONF_THRESHOLD:
                continue
            x1, y1, x2, y2 = (int(v) for v in box)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(img.width, x2), min(img.height, y2)
            if x2 <= x1 or y2 <= y1:
                continue
            out.append({
                "label": LABELS.get(int(lab), str(int(lab))),
                "score": round(float(scr), 3),
                "x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1,
            })
        return out


def detect_ocr(detector, mocr, image_path: str) -> dict:
    img = Image.open(image_path).convert("RGB")
    t0 = time.time()
    blocks = detector.detect(img)
    detect_ms = (time.time() - t0) * 1000

    # 粗略閱讀順序:上到下,同高度帶右到左(漫畫 RTL)。POC 夠用,之後做 panel-aware。
    blocks.sort(key=lambda b: (b["y"] + b["h"] / 2, -(b["x"] + b["w"] / 2)))

    ocr_ms_total = 0.0
    for b in blocks:
        if b["label"] not in TEXT_LABELS:
            continue
        pad_x = int(b["w"] * OCR_PAD_RATIO)
        pad_y = int(b["h"] * OCR_PAD_RATIO)
        crop = img.crop((
            max(0, b["x"] - pad_x),
            max(0, b["y"] - pad_y),
            min(img.width, b["x"] + b["w"] + pad_x),
            min(img.height, b["y"] + b["h"] + pad_y),
        ))
        t = time.time()
        b["text"] = mocr(crop)
        ocr_ms_total += (time.time() - t) * 1000

    log(f"{os.path.basename(image_path)}: {len(blocks)} blocks, "
        f"detect {detect_ms:.0f}ms, ocr {ocr_ms_total:.0f}ms")
    return {"width": img.width, "height": img.height, "blocks": blocks}


def load_models():
    emit({"event": "loading", "detail": "偵測模型（RT-DETR-v2）"})
    detector = Detector()
    emit({"event": "loading", "detail": "OCR 模型（manga-ocr）"})
    from manga_ocr import MangaOcr
    mocr = MangaOcr()
    emit({"event": "ready"})
    return detector, mocr


def serve():
    detector, mocr = load_models()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            emit({"id": None, "ok": False, "error": "bad json"})
            continue
        try:
            if req.get("cmd") == "detect_ocr":
                res = detect_ocr(detector, mocr, req["image"])
                emit({"id": req.get("id"), "ok": True, **res})
            elif req.get("cmd") == "ping":
                emit({"id": req.get("id"), "ok": True})
            else:
                emit({"id": req.get("id"), "ok": False, "error": "unknown cmd"})
        except Exception as e:  # noqa: BLE001 — sidecar 不能死,錯誤回給呼叫端
            emit({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"})


def annotate(image_path: str, result: dict, out_path: str):
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    colors = {"bubble": "#2e9e44", "text_bubble": "#d33", "text_free": "#d380ff"}
    for i, b in enumerate(result["blocks"]):
        c = colors.get(b["label"], "#888")
        draw.rectangle([b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]], outline=c, width=4)
        draw.text((b["x"] + 4, b["y"] + 4), f'{i} {b["label"]}', fill=c)
    img.save(out_path)
    log(f"annotated → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", metavar="IMAGE", help="單張測試後退出")
    ap.add_argument("--annotate", metavar="OUT_PNG", help="搭配 --once,輸出畫框圖")
    args = ap.parse_args()

    if args.once:
        detector, mocr = load_models()
        res = detect_ocr(detector, mocr, args.once)
        emit(res)
        if args.annotate:
            annotate(args.once, res, args.annotate)
        return
    serve()


if __name__ == "__main__":
    main()
