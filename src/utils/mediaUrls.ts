// 路徑含 URL 保留字（# ? % 等）不 encode 會在 protocol 抵達 main process 前
// 被截斷。逐 segment encodeURIComponent，保留 '/' 作為分隔符。
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function imageSrc(folderPath: string, filename: string): string {
  return `local-file://${encodePath(`${folderPath}/${filename}`)}`
}
