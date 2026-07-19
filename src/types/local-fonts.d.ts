// Local Font Access API(Chromium 103+):lib.dom 尚未收錄,自行宣告。
// 已實測:Electron 43 renderer 無手勢、無權限 handler 即可枚舉全部字體。
interface LocalFontData {
  readonly family: string
  readonly fullName: string
  readonly postscriptName: string
  readonly style: string
}

declare function queryLocalFonts(): Promise<LocalFontData[]>
