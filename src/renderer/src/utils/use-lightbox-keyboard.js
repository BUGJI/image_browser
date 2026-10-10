import { useEventListener } from '@vueuse/core'
import { eventMatches } from './shortcuts'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 焦点在输入类元素（如标签 el-select 的搜索框）时，不拦截按键，
// 否则打字时方向键会切图、Esc 会关灯箱、Ctrl+C 会被复制逻辑抢走。
function isEditableTarget(t) {
  const el = t
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/**
 * 灯箱键盘：导航键（←/→/Esc）、可自定义复制快捷键、Tab 焦点陷阱。从 Lightbox.vue 拆出。
 * 全局 keydown 监听随组件卸载自动清理（@vueuse/core）。
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.maskRef 遮罩元素引用（焦点陷阱范围）
 * @param {Function} deps.onPrev 上一张
 * @param {Function} deps.onNext 下一张
 * @param {Function} deps.onClose 关闭
 * @param {Function} deps.onCopyFile 复制原文件
 * @param {Function} deps.onCopyImage 复制图片
 * @param {() => Object} deps.getShortcuts 读取当前快捷键配置
 */
export function useLightboxKeyboard({
  maskRef,
  onPrev,
  onNext,
  onClose,
  onCopyFile,
  onCopyImage,
  getShortcuts
}) {
  // 把 Tab 焦点限制在灯箱内（含首次进入：焦点落在遮罩上时纳入第一个可聚焦元素）。
  // 标签编辑弹层被 Teleport 到 body，单独纳入循环，避免键盘焦点被弹出。
  function trapTab(e) {
    const roots = [maskRef.value, document.querySelector('.lightbox-tag-popper')].filter(Boolean)
    if (!roots.length) return
    const list = roots
      .flatMap((r) => Array.from(r.querySelectorAll(FOCUSABLE_SELECTOR)))
      .filter((el) => el.getClientRects().length > 0)
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    const inside = roots.some((r) => r.contains(active))
    if (!inside) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function onKeydown(e) {
    if (e.key === 'Tab') {
      trapTab(e)
      return
    }
    if (isEditableTarget(e.target)) return
    const sc = getShortcuts()
    if (eventMatches(e, sc.copyFile)) {
      e.preventDefault()
      onCopyFile()
      return
    }
    if (eventMatches(e, sc.copyImage)) {
      e.preventDefault()
      onCopyImage()
      return
    }
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowLeft') {
      onPrev()
    } else if (e.key === 'ArrowRight') {
      onNext()
    }
  }

  useEventListener(window, 'keydown', onKeydown)

  return { onKeydown }
}
