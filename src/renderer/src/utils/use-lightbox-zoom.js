import { computed, ref } from 'vue'

/**
 * 灯箱图片缩放/平移视图（以中心为缩放锚点）。
 * 从 Lightbox.vue 拆出；缩放上下限由「设置 - 开发者选项」通过 setZoomConfig 注入。
 */
export function useLightboxZoom() {
  const zoomCfg = ref({ min: 1, max: 8, step: 1.2 })
  const view = ref({ scale: 1, tx: 0, ty: 0 })

  const imgStyle = computed(() => {
    const { scale, tx, ty } = view.value
    return { transform: `translate(${tx}px, ${ty}px) scale(${scale})` }
  })

  function resetView() {
    view.value = { scale: zoomCfg.value.min, tx: 0, ty: 0 }
  }

  function zoomAtCenter(factor) {
    const { min, max } = zoomCfg.value
    const s = Math.min(max, Math.max(min, view.value.scale * factor))
    const ratio = s / view.value.scale
    view.value = { scale: s, tx: view.value.tx * ratio, ty: view.value.ty * ratio }
  }

  function zoomIn() {
    zoomAtCenter(zoomCfg.value.step)
  }

  function zoomOut() {
    zoomAtCenter(1 / zoomCfg.value.step)
  }

  // 平移（仅 scale > 1 时）
  let panStart = null
  function onImgMouseDown(e) {
    if (view.value.scale <= 1 || e.button !== 0) return
    panStart = { sx: e.clientX, sy: e.clientY, tx: view.value.tx, ty: view.value.ty }
    e.preventDefault()
  }
  function onWinMouseMove(e) {
    if (!panStart) return
    view.value = {
      scale: view.value.scale,
      tx: panStart.tx + (e.clientX - panStart.sx),
      ty: panStart.ty + (e.clientY - panStart.sy)
    }
  }
  function onWinMouseUp() {
    panStart = null
  }

  /** 应用「设置 - 开发者选项」的缩放限制，并在初始时把 scale 夹到 [min, max] 且不小于 1 */
  function setZoomConfig({ min, max, step }) {
    const safeMax = Math.max(max, min)
    zoomCfg.value = { min, max: safeMax, step }
    view.value = { scale: Math.min(Math.max(1, min), safeMax), tx: 0, ty: 0 }
  }

  return {
    zoomCfg,
    view,
    imgStyle,
    resetView,
    zoomAtCenter,
    zoomIn,
    zoomOut,
    onImgMouseDown,
    onWinMouseMove,
    onWinMouseUp,
    setZoomConfig
  }
}
