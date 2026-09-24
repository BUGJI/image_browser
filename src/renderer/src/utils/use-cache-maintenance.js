import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationsStore } from '../stores/notifications'
import { rootDisplayName as displayName } from '../utils/roots'

/**
 * 缓存维护任务的公共逻辑（进度通知 + 状态）。
 *
 * 「设置 - 根目录」用它做每行的一键「更新缓存」；
 * 「设置 - 浏览与性能」用它提供四种模式的完整维护。
 * 两处共用同一套通知/进度处理，避免逻辑重复。
 *
 * 用法：attach() 注册进度监听（组件挂载），detach() 注销（卸载）。
 */
export function useCacheMaintenance() {
  const { t } = useI18n()
  const notificationsStore = useNotificationsStore()

  const busy = ref(false) // 是否有维护任务进行中
  const runningRootId = ref(null) // 正在进行维护的根目录 id

  let offProgress = null
  let notifyId = null
  let activeRootId = null
  let doneCb = null

  const modes = computed(() => [
    { label: t('roots.updateCache'), mode: 'update' },
    { label: t('roots.rebuildCache'), mode: 'rebuild' },
    { label: t('roots.scanCache'), mode: 'scan-cache' },
    { label: t('roots.cleanCache'), mode: 'clean' }
  ])

  function reset() {
    busy.value = false
    runningRootId.value = null
    activeRootId = null
    notifyId = null
    const cb = doneCb
    doneCb = null
    cb?.()
  }

  /**
   * 启动一次维护任务。
   * @param {object|number} root 根对象或根 id
   * @param {'update'|'rebuild'|'scan-cache'|'clean'} mode
   * @param {{ onDone?: () => void }} [opts] onDone：任务结束（成功/中止/失败）后回调
   */
  function start(root, mode, { onDone } = {}) {
    const rootId = typeof root === 'object' ? root.id : root
    const label = typeof root === 'object' ? displayName(root) : String(root)
    const item = modes.value.find((m) => m.mode === mode) || { label: mode }

    busy.value = true
    runningRootId.value = rootId
    activeRootId = rootId
    doneCb = onDone || null
    notifyId = notificationsStore.add({
      type: 'progress',
      title: `${item.label} · ${label}`,
      message: t('common.preparing'),
      cancellable: true,
      onCancel: () => window.api.cacheAbort()
    })

    return window.api.cacheRun(rootId, mode).catch((err) => {
      if (notifyId) {
        notificationsStore.finish(notifyId, 'aborted', {
          message: t('roots.startFailed', { error: String(err?.message || err) })
        })
      }
      reset()
    })
  }

  function onProgress(p) {
    if (p.rootId !== activeRootId || !notifyId) return

    // thumb 进度事件的 done 是数字；任务完成标志是 done === true
    const finished = p.done === true

    if (p.error) {
      notificationsStore.finish(notifyId, 'aborted', { message: p.error })
      reset()
      return
    }
    if (p.aborted) {
      notificationsStore.finish(notifyId, 'aborted', { message: t('notifications.aborted') })
      reset()
      return
    }
    if (finished) {
      const s = p.stats || {}
      const added = s.added ?? 0
      const updated = s.updated ?? 0
      const removed = s.removed ?? 0
      const parts = []
      if (added) parts.push(t('notifications.statsAdded', { n: added }))
      if (updated) parts.push(t('notifications.statsUpdated', { n: updated }))
      if (removed) parts.push(t('notifications.statsRemoved', { n: removed }))
      parts.push(t('notifications.statsThumbs', { n: s.thumbs ?? 0 }))
      if (s.failed) parts.push(t('notifications.statsFailed', { n: s.failed }))
      if (s.cleanedThumbs)
        parts.push(t('notifications.statsCleanedOrphans', { n: s.cleanedThumbs }))
      notificationsStore.finish(notifyId, 'done', {
        message: t('app.scanSummary', {
          n: added + updated + removed,
          parts: parts.join(t('common.separator'))
        })
      })
      reset()
      return
    }
    if (p.phase === 'scan') {
      notificationsStore.update(notifyId, { message: t('app.scanningFiles', { n: p.scanned }) })
    } else if (p.phase === 'thumb') {
      notificationsStore.updateProgress(notifyId, Math.round((p.done / p.total) * 100))
      notificationsStore.update(notifyId, {
        message: t('app.generatingThumbs', {
          done: p.done,
          total: p.total,
          current: p.current || ''
        })
      })
    }
  }

  function attach() {
    if (offProgress) return
    offProgress = window.api.onCacheProgress(onProgress)
  }

  function detach() {
    offProgress?.()
    offProgress = null
  }

  return { busy, runningRootId, modes, start, attach, detach }
}
