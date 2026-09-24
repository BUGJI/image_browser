import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationsStore } from '../stores/notifications'
import { rootDisplayName } from './roots'

/**
 * 索引维护的通用流程（AI 语义索引 / OCR 文字索引共用）：
 * - 加载根目录列表、记录维护目标
 * - 触发维护任务并显示可取消的进度通知
 * - 消费进度事件（error / aborted / done / 阶段进度）并汇总统计
 * - 组件卸载时自动取消进度订阅
 *
 * @param {object} cfg
 * @param {import('vue').ComputedRef<Array<{label:string,mode:string}>>} cfg.actions 维护按钮定义
 * @param {{index:(rootId:number,mode:string)=>Promise<any>, abort:()=>any, onProgress:(cb:Function)=>()=>void}} cfg.api IPC 三件套
 * @param {() => boolean} cfg.canRun 功能是否可用（AI：已启用；OCR：运行时已安装）
 * @param {string} cfg.noRootWarn 未选择根目录时的提示
 * @param {string} cfg.disabledWarn 功能不可用时的提示
 * @param {string} cfg.phase 阶段名（AI：'embed'；OCR：'ocr'）
 * @param {(p:object) => string} cfg.phaseMessage 阶段中的进度文案
 * @param {(stats:object) => string} cfg.summary 完成时的统计文案（无统计时返回空串）
 * @param {string} cfg.doneMessage 无统计时的完成文案
 * @param {(error:string) => string} cfg.startFailed 启动失败文案
 * @param {() => void} [cfg.onDone] 完成后的额外回调（如刷新状态）
 */
export function useIndexMaintenance(cfg) {
  const { t } = useI18n()
  const notificationsStore = useNotificationsStore()

  const maintainBusy = ref(false)
  const maintainRootId = ref(null)
  const maintainRoots = ref([])
  let notifyId = null
  let activeRootId = null

  async function loadRoots() {
    maintainRoots.value = await window.api.rootsList()
  }

  function reset() {
    maintainBusy.value = false
    notifyId = null
    activeRootId = null
  }

  function finishAborted(message) {
    if (notifyId) notificationsStore.finish(notifyId, 'aborted', { message })
    reset()
  }

  function onProgress(p) {
    if (p.rootId !== activeRootId || !notifyId) return

    if (p.error) return finishAborted(p.error)
    if (p.aborted) return finishAborted(t('notifications.aborted'))

    if (p.done === true) {
      const message = cfg.summary(p.stats || {}) || cfg.doneMessage
      notificationsStore.finish(notifyId, 'done', { message })
      reset()
      cfg.onDone?.()
      return
    }

    if (p.phase === cfg.phase) {
      notificationsStore.update(notifyId, { message: cfg.phaseMessage(p) })
      if (p.total) {
        notificationsStore.updateProgress(notifyId, Math.round((p.done / p.total) * 100))
      }
    }
  }

  function maintainIndex(mode) {
    const item = cfg.actions.value.find((m) => m.mode === mode)
    const root = maintainRoots.value.find((r) => r.id === maintainRootId.value)
    if (!root) {
      ElMessage.warning(cfg.noRootWarn)
      return
    }
    if (!cfg.canRun()) {
      ElMessage.warning(cfg.disabledWarn)
      return
    }

    maintainBusy.value = true
    activeRootId = root.id
    notifyId = notificationsStore.add({
      type: 'progress',
      title: `${item?.label || ''} · ${rootDisplayName(root)}`,
      message: t('common.preparing'),
      cancellable: true,
      onCancel: () => cfg.api.abort()
    })

    cfg.api.index(root.id, mode).catch((err) => {
      if (notifyId) {
        notificationsStore.finish(notifyId, 'aborted', {
          message: cfg.startFailed(String(err?.message || err))
        })
      }
      reset()
    })
  }

  const offProgress = cfg.api.onProgress(onProgress)
  onMounted(loadRoots)
  onBeforeUnmount(() => offProgress?.())

  return { maintainBusy, maintainRootId, maintainRoots, loadRoots, maintainIndex }
}
