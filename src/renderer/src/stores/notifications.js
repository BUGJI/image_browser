import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 全局通知中心
 *
 * 统一模型：{ id, type, title, message, actions, cancellable, progress,
 *             status, read, createdAt, onCancel }
 * - type: 'info' | 'success' | 'warning' | 'error' | 'progress'
 * - status: 'active'(左下角弹出) | 'done' | 'aborted' | 'dismissed'(归档保留)
 * - actions: [{ label, kind, onClick }] 常规操作按钮（确定/取消/查看…）
 * - cancellable + onCancel：进度类的中止按钮
 *
 * 弹出（左下角）只显示 status==='active'；消失后仍留在历史面板。
 */

let seq = 0
const MAX_ITEMS = 200
// 纯提示（无按钮、非进度）自动收起的毫秒数
const AUTO_DISMISS_MS = 6000

export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref([])
  // 自动收起定时器：随通知移除而清理，避免悬空 timer 长期持有闭包
  const autoTimers = new Map()

  function clearAutoTimer(id) {
    const t = autoTimers.get(id)
    if (t) {
      clearTimeout(t)
      autoTimers.delete(id)
    }
  }

  const unreadCount = computed(() => items.value.filter((n) => !n.read).length)

  // 左下角弹出区：进行中的通知
  const popups = computed(() => items.value.filter((n) => n.status === 'active'))

  function add({
    type = 'info',
    title = '',
    message = '',
    actions = [],
    cancellable = false,
    onCancel = null,
    autoClose = true
  }) {
    const id = `notify-${++seq}-${Date.now()}`
    items.value.unshift({
      id,
      type,
      title,
      message,
      actions,
      cancellable,
      onCancel,
      progress: null,
      status: 'active',
      read: false,
      createdAt: Date.now()
    })
    trim()
    // 纯提示自动收起（保留历史）；有按钮/进度/明确 autoClose=false 的不自动关
    if (autoClose && !actions.length && !cancellable) {
      autoTimers.set(
        id,
        setTimeout(() => {
          autoTimers.delete(id)
          dismiss(id)
        }, AUTO_DISMISS_MS)
      )
    }
    return id
  }

  function find(id) {
    return items.value.find((n) => n.id === id)
  }

  function update(id, patch) {
    const n = find(id)
    if (n) Object.assign(n, patch)
  }

  function updateProgress(id, progress) {
    update(id, { progress })
  }

  /** 结束进度类通知：done / aborted，保留在历史 */
  function finish(id, status = 'done', extra = {}) {
    update(id, { status, ...extra })
  }

  /** 收起通知（用户操作后归档，保留历史） */
  function dismiss(id) {
    clearAutoTimer(id)
    update(id, { status: 'dismissed' })
  }

  function remove(id) {
    clearAutoTimer(id)
    items.value = items.value.filter((n) => n.id !== id)
  }

  function clearAll() {
    for (const id of autoTimers.keys()) clearTimeout(autoTimers.get(id))
    autoTimers.clear()
    items.value = []
  }

  function markAllRead() {
    items.value.forEach((n) => {
      n.read = true
    })
  }

  function trim() {
    if (items.value.length > MAX_ITEMS) {
      items.value = items.value.slice(0, MAX_ITEMS)
    }
  }

  return {
    items,
    unreadCount,
    popups,
    add,
    find,
    update,
    updateProgress,
    finish,
    dismiss,
    remove,
    clearAll,
    markAllRead
  }
})
