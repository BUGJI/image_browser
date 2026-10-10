import { useNotificationsStore } from '../stores/notifications'

/**
 * 启动更新检测推送：主进程发现新版本时，在全局通知列表加入「忽略 / 查看」通知。
 * 从 App.vue 拆出。
 *
 * @param {Object} deps
 * @param {(key: string, params?: Object) => string} deps.t i18n 翻译函数
 */
const UPDATE_RELEASES_URL = 'https://github.com/BUGJI/image_browser/releases'

export function useUpdateNotify({ t }) {
  const notificationsStore = useNotificationsStore()

  function show(p) {
    if (!p?.latestVersion) return
    notificationsStore.add({
      type: 'info',
      title: t('update.title', { version: p.latestVersion }),
      message: p.releaseNotes
        ? t('update.releaseNote', { notes: String(p.releaseNotes).slice(0, 500) })
        : t('update.msg', { version: p.latestVersion }),
      actions: [
        {
          label: t('update.view'),
          kind: 'primary',
          onClick: () => window.api?.openExternal(p.downloadUrl || UPDATE_RELEASES_URL)
        },
        { label: t('update.later'), kind: 'default' }
      ]
    })
  }

  /** 订阅更新可用事件，返回取消订阅函数 */
  function subscribe() {
    return window.api.onUpdateAvailable((p) => show(p))
  }

  return { show, subscribe }
}
