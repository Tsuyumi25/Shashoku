// 匯入字體:不裝進系統,只接進 app 私有的 fontconfig(main 側寫
// fonts.conf + FONTCONFIG_FILE)。字體因此走平台路徑——不過 OTS 消毒
// (舊 CJK 字體大量被 web font 路線拒收)、queryLocalFonts 直接枚舉到、
// ttc 全部 face 可用。代價:改資料夾要重啟 app 才生效(fontconfig 在
// Chromium 初始化時讀一次),needsRestart 旗標供 UI 提示。
import { ref } from "vue";

export const fontFolders = ref<string[]>([]);
/** 匯入資料夾掃出的家族名(全部 face):供「已匯入」群組與徽章;
 * 重啟前就看得到清單,只是渲染要等 fontconfig 生效 */
export const importedFamilies = ref<string[]>([]);
export const fontsNeedRestart = ref(false);

async function rescanFamilies(): Promise<void> {
  const seen = new Set<string>();
  for (const folder of fontFolders.value) {
    for (const file of await window.api.scanFontFolder(folder)) {
      for (const face of file.faces) seen.add(face.family);
    }
  }
  importedFamilies.value = [...seen];
}

let inited = false;
export async function initImportedFonts(): Promise<void> {
  if (inited) return;
  inited = true;
  fontFolders.value = await window.api.listFontFolders();
  // 一次性遷移:v1(FontFace 機制)把資料夾存在 localStorage
  const legacy = localStorage.getItem("shashoku:font-folders");
  if (legacy) {
    try {
      const v: unknown = JSON.parse(legacy);
      if (Array.isArray(v)) {
        const merged = [
          ...new Set([...fontFolders.value, ...v.filter((x): x is string => typeof x === "string")]),
        ];
        if (merged.length !== fontFolders.value.length) {
          fontFolders.value = merged;
          await window.api.setFontFolders(merged);
          fontsNeedRestart.value = true;
        }
      }
    } catch {
      // 壞資料直接丟棄
    }
    localStorage.removeItem("shashoku:font-folders");
  }
  await rescanFamilies();
}

export async function addFontFolder(): Promise<void> {
  const folder = await window.api.pickFontFolder();
  if (!folder || fontFolders.value.includes(folder)) return;
  fontFolders.value = [...fontFolders.value, folder];
  await window.api.setFontFolders(fontFolders.value);
  fontsNeedRestart.value = true;
  await rescanFamilies();
}

export async function removeFontFolder(folder: string): Promise<void> {
  fontFolders.value = fontFolders.value.filter((f) => f !== folder);
  await window.api.setFontFolders(fontFolders.value);
  fontsNeedRestart.value = true;
  await rescanFamilies();
}
