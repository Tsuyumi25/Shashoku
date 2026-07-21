// 字型 picker 的全域 singleton state:StyleEditor(sidebar 內)呼叫 open,
// TranslateMode(畫布區域)渲染 overlay,兩者透過這裡的 promise 對接。
// 選中 → resolve(name);取消 → resolve(null),呼叫端 await 拿到結果。
import { ref } from 'vue'

const isOpen = ref(false)
const initialQuery = ref('')
/** picker 綁定的目標:null = 預設樣式,string = 樣式群組 id。preview 判斷
 * 哪些 label 該套預覽字型時,和 label.groupId 比對(語意和 activeGroupId 一致) */
const targetGroupId = ref<string | null>(null)
/** 目前 hover 預覽中的字型名;null = 沒在預覽 */
const previewFont = ref<string | null>(null)
let resolver: ((name: string | null) => void) | null = null

export function useFontPicker() {
  return {
    isOpen,
    initialQuery,
    targetGroupId,
    previewFont,
    /**
     * current:當前字型,預填搜索框幫用戶找起點。
     * target:string 樣式群組 id / null 預設樣式,決定 preview 影響哪些 label。
     * 回傳 Promise:選中的字型名 / null(取消)
     */
    open(current = '', target: string | null = null): Promise<string | null> {
      initialQuery.value = current
      targetGroupId.value = target
      isOpen.value = true
      return new Promise((res) => {
        resolver = res
      })
    },
    select(name: string) {
      isOpen.value = false
      previewFont.value = null
      const r = resolver
      resolver = null
      r?.(name)
    },
    cancel() {
      isOpen.value = false
      previewFont.value = null
      const r = resolver
      resolver = null
      r?.(null)
    },
    startPreview(font: string) {
      previewFont.value = font
    },
    endPreview() {
      previewFont.value = null
    },
  }
}
