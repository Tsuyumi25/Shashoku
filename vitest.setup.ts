// node 環境的最小 canvas stub。
//
// 測試紀律(調研定案):像素「正確性」只測純 buffer 函式(brush/composite/
// screentone——它們不碰 canvas);Document/actions 的測試只驗「結構與 undo」,
// canvas 快取路徑用 stub 空轉即可。刻意不引入 node-canvas(原生依賴重、
// createImageBitmap 開洞多年未實作)。
//
// 注意:stub 的 getImageData 回全零——依賴 canvas 合成結果的斷言(如 mergeDown
// 的像素內容)在 node 下沒有意義,規格書於各 spec 內。

/* eslint-disable @typescript-eslint/no-explicit-any */

class StubImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    maybeHeight?: number,
  ) {
    if (typeof dataOrWidth === "number") {
      this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
    } else {
      this.data = dataOrWidth;
    }
    void maybeHeight;
  }
}

class StubContext2D {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  fillStyle = "";
  putImageData(): void {}
  drawImage(): void {}
  clearRect(): void {}
  fillRect(): void {}
  getImageData(_x: number, _y: number, w: number, h: number): StubImageData {
    return new StubImageData(w, h);
  }
}

class StubOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): StubContext2D {
    return new StubContext2D();
  }
  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob());
  }
}

const g = globalThis as any;
if (typeof g.ImageData === "undefined") g.ImageData = StubImageData;
if (typeof g.OffscreenCanvas === "undefined") g.OffscreenCanvas = StubOffscreenCanvas;
