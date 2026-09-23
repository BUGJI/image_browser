<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { InfoFilled } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../stores/notifications'
import { NOTIFY_TYPE_ICON as TYPE_ICON, NOTIFY_TYPE_COLOR as TYPE_COLOR } from '../utils/notification-types'

/**
 * 通知中心：铃铛按钮 + 历史面板（popover）。
 * 面板内容挂到 body，相关样式为全局（见文件末尾 <style>）。
 */
const { t } = useI18n()
const notificationsStore = useNotificationsStore()

const STATUS_TAG = computed(() => ({
  active: { label: t('notifications.active'), type: 'primary' },
  done: { label: t('notifications.done'), type: 'success' },
  aborted: { label: t('notifications.aborted'), type: 'warning' },
  dismissed: { label: t('notifications.dismissed'), type: 'info' }
}))

function statusTag(n) {
  return STATUS_TAG.value[n.status] || null
}

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (d.toDateString() === now.toDateString()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}
</script>

<template>
  <el-popover
    placement="bottom-end"
    :width="380"
    trigger="click"
    popper-class="notify-popper"
    @show="notificationsStore.markAllRead()"
  >
    <template #reference>
      <el-badge
        :value="notificationsStore.unreadCount"
        :hidden="notificationsStore.unreadCount === 0"
        :max="99"
        :offset="[-4, 6]"
        class="notify-badge"
      >
        <button class="toolbar-btn" :title="t('app.notifications')" :aria-label="t('app.notifications')">
          <el-icon :size="16"><Bell /></el-icon>
        </button>
      </el-badge>
    </template>

    <div class="notify-panel">
      <div class="notify-panel-head">
        <span class="notify-panel-title">{{ t('app.notifications') }}</span>
        <el-button
          v-if="notificationsStore.items.length"
          link
          type="primary"
          size="small"
          @click="notificationsStore.clearAll()"
        >
          {{ t('app.clearAll') }}
        </el-button>
      </div>

      <div v-if="!notificationsStore.items.length" class="notify-panel-empty">
        {{ t('app.noNotifications') }}
      </div>

      <div v-else class="notify-list">
        <div
          v-for="n in notificationsStore.items"
          :key="n.id"
          class="notify-item"
          :class="{ 'notify-item-unread': !n.read }"
        >
          <el-icon :size="15" class="notify-item-icon" :style="{ color: TYPE_COLOR[n.type] }">
            <component :is="TYPE_ICON[n.type] || InfoFilled" />
          </el-icon>
          <div class="notify-item-main">
            <div class="notify-item-title">
              {{ n.title }}
              <el-tag
                v-if="statusTag(n)"
                size="small"
                :type="statusTag(n).type"
                class="notify-status-tag"
              >
                {{ statusTag(n).label }}
              </el-tag>
            </div>
            <div v-if="n.message" class="notify-item-msg">{{ n.message }}</div>
            <div class="notify-item-foot">
              <span class="notify-item-time">{{ fmtTime(n.createdAt) }}</span>
              <span v-if="n.actions.length" class="notify-item-actions">
                <el-button
                  v-for="a in n.actions"
                  :key="a.label"
                  link
                  size="small"
                  :type="a.kind === 'primary' ? 'primary' : 'default'"
                  @click="a.onClick?.()"
                >
                  {{ a.label }}
                </el-button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<style>
/* 通知历史面板（popover 挂 body 下，需全局样式） */
.notify-badge {
  pointer-events: auto;
}

.notify-popper {
  padding: 8px !important;
}

.notify-panel {
  display: flex;
  flex-direction: column;
  max-height: 420px;
}

.notify-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.notify-panel-title {
  font-weight: 600;
  font-size: 14px;
}

.notify-panel-empty {
  padding: 40px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.notify-list {
  overflow-y: auto;
  max-height: 360px;
  display: flex;
  flex-direction: column;
}

.notify-item {
  display: flex;
  gap: 8px;
  padding: 10px 6px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.notify-item-unread {
  background: var(--el-color-primary-light-9);
}

.notify-item-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

.notify-item-main {
  flex: 1;
  min-width: 0;
}

.notify-item-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.notify-status-tag {
  height: 18px;
  line-height: 18px;
}

.notify-item-msg {
  margin-top: 3px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
  line-height: 1.5;
}

.notify-item-foot {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notify-item-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.notify-item-actions {
  display: flex;
  gap: 4px;
}
</style>
