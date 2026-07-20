import { CATEGORY_COLORS } from '@shared/ssk/constants'
import { labelTextCss, type LabelTextStyle } from '@/lib/labelTextStyle'
import type { LabelItem } from '@/types/project'

interface LabelDragPreviewOptions {
  scale: number
  rotation: number
  sourceRect: DOMRect
  hotspot: { x: number; y: number }
}

interface LabelDragPreviewMetrics {
  grabOffset: { x: number; y: number }
}

/**
 * 以目前螢幕尺寸建立不透明的自訂 drag image。原生預設 ghost
 * 會忽略畫布外層的 zoom transform，所以不能直接使用 source element。
 */
export function setLabelDragPreview(
  dataTransfer: DataTransfer,
  label: LabelItem,
  textStyle: LabelTextStyle,
  options: LabelDragPreviewOptions,
): LabelDragPreviewMetrics {
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    pointerEvents: 'none',
    background: 'transparent',
    zIndex: '2147483647',
  })

  if (label.text === '') {
    const diameter = Math.max(options.sourceRect.width, options.sourceRect.height, 18)
    const dot = document.createElement('div')
    Object.assign(dot.style, {
      width: `${diameter}px`,
      height: `${diameter}px`,
      borderRadius: '9999px',
      backgroundColor: CATEGORY_COLORS[label.category - 1] ?? 'rgb(128, 128, 128)',
    })
    wrapper.style.width = `${diameter}px`
    wrapper.style.height = `${diameter}px`
    wrapper.append(dot)
  } else {
    const text = document.createElement('div')
    const css = labelTextCss(textStyle)
    Object.assign(text.style, css, {
      position: 'absolute',
      fontSize: `${Number.parseFloat(css.fontSize) * options.scale}px`,
      transformOrigin: 'center',
    })
    text.textContent = label.text
    wrapper.append(text)
    document.body.append(wrapper)

    const width = text.offsetWidth
    const height = text.offsetHeight
    const cos = Math.abs(Math.cos(options.rotation))
    const sin = Math.abs(Math.sin(options.rotation))
    const rotatedWidth = width * cos + height * sin
    const rotatedHeight = width * sin + height * cos
    wrapper.style.width = `${rotatedWidth}px`
    wrapper.style.height = `${rotatedHeight}px`
    text.style.left = `${(rotatedWidth - width) / 2}px`
    text.style.top = `${(rotatedHeight - height) / 2}px`
    text.style.transform = `rotate(${options.rotation}rad)`
  }

  if (!wrapper.isConnected) document.body.append(wrapper)
  const previewRect = wrapper.getBoundingClientRect()
  const hotspotX = options.sourceRect.width > 0
    ? options.hotspot.x * previewRect.width / options.sourceRect.width
    : previewRect.width / 2
  const hotspotY = options.sourceRect.height > 0
    ? options.hotspot.y * previewRect.height / options.sourceRect.height
    : previewRect.height / 2
  const grabOffset = {
    x: Math.min(Math.max(hotspotX, 0), previewRect.width),
    y: Math.min(Math.max(hotspotY, 0), previewRect.height),
  }
  dataTransfer.setDragImage(
    wrapper,
    grabOffset.x,
    grabOffset.y,
  )
  setTimeout(() => wrapper.remove(), 0)
  return { grabOffset }
}
