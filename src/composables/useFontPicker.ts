// 字型 picker 的全域 singleton state:StyleEditor(sidebar 內)呼叫 open,
// TranslateMode(畫布區域)渲染 overlay,兩者透過這裡的 promise 對接。
// 選中 → resolve(name);取消 → resolve(null),呼叫端 await 拿到結果。
import { ref } from 'vue'

const isOpen = ref(false)
const initialQuery = ref('')
let resolver: ((name: string | null) => void) | null = null

export function useFontPicker() {
  return {
    isOpen,
    initialQuery,
    /** current:當前字型,預填搜索框幫用戶找起點。回傳 Promise:選中的字型名 / null(取消) */
    open(current = ''): Promise<string | null> {
      initialQuery.value = current
      isOpen.value = true
      return new Promise((res) => {
        resolver = res
      })
    },
    select(name: string) {
      isOpen.value = false
      const r = resolver
      resolver = null
      r?.(name)
    },
    cancel() {
      isOpen.value = false
      const r = resolver
      resolver = null
      r?.(null)
    },
  }
}
