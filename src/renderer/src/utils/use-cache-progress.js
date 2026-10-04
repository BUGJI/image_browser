import { useI18n } from 'vue-i18n'

/**
 * 全局缓存维护进度 → 主窗口通知列表（滞留显示，可中止）。
 * 从 App.vue 拆出。onReady 在「当前根目录」维护完成时回调（用于刷新瀑布流）。
 */
export function useGlobalCacheProgress({ notificationsStore, rootsStore, onReady }) {
  const { t } = useI18n()
  let cacheNotifyId = null
  let cacheRootKey = null

  function onGlobalCacheProgress(p) {
    // 新任务（rootId 变化）→ 创建通知
    if (cacheRootKey !== p.rootId) {
      cacheRootKey = p.rootId
      cacheNotifyId = notificationsStore.add({
        type: 'progress',
        title: t('app.cacheMaintenance'),
        message: t('common.preparing'),
        cancellable: true,
        onCancel: () => window.api.cacheAbort()
      })
    }
    if (!cacheNotifyId) return

    // 注意：thumb 进度事件里的 done 是数字（已处理张数），任务完成标志是 done === true
    const finished = p.done === true

    if (p.error) {
      notificationsStore.finish(cacheNotifyId, 'aborted', { message: p.error })
      cacheNotifyId = null
      cacheRootKey = null
      return
    }
    if (p.aborted) {
      notificationsStore.finish(cacheNotifyId, 'aborted', { message: t('notifications.aborted') })
      cacheNotifyId = null
      cacheRootKey = null
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
      notificationsStore.finish(cacheNotifyId, 'done', {
        message: t('app.scanSummary', {
          n: added + updated + removed,
          parts: parts.join(t('common.separator'))
        })
      })
      cacheNotifyId = null
      cacheRootKey = null
      // 缓存就绪：当前根目录刷新瀑布流，改用缩略图
      if (p.rootId === rootsStore.currentRoot?.id) onReady?.()
      return
    }
    if (p.phase === 'scan') {
      notificationsStore.update(cacheNotifyId, {
        message: t('app.scanningFiles', { n: p.scanned })
      })
    } else if (p.phase === 'thumb') {
      notificationsStore.updateProgress(cacheNotifyId, Math.round((p.done / p.total) * 100))
      notificationsStore.update(cacheNotifyId, {
        message: t('app.generatingThumbs', {
          done: p.done,
          total: p.total,
          current: p.current || ''
        })
      })
    }
  }

  return { onGlobalCacheProgress }
}
