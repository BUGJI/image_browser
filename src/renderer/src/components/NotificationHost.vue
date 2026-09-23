<script setup>
import { useI18n } from 'vue-i18n'
import { InfoFilled } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../stores/notifications'
import { useAnimationsStore } from '../stores/animations'
import { NOTIFY_TYPE_ICON as TYPE_ICON, NOTIFY_TYPE_COLOR as TYPE_COLOR } from '../utils/notification-types'

const { t } = useI18n()
const store = useNotificationsStore()
const animations = useAnimationsStore()

/** 点击操作按钮：先执行业务回调，再收起（若还在弹出区） */
function onActionClick(n, action) {
  action.onClick?.()
  if (n.status === 'active') store.dismiss(n.id)
}

function onCancel(n) {
  n.onCancel?.()
}
</script>

<template>
  <Teleport to="body">
    <div class="notify-host" :class="{ 'no-notify-anim': !animations.animNotify }">
      <TransitionGroup name="notify-pop">
        <div
          v-for="n in store.popups"
          :key="n.id"
          class="notify-card"
          :class="`notify-${n.type}`"
        >
          <div class="notify-head">
            <el-icon :size="16" :style="{ color: TYPE_COLOR[n.type] }">
              <component :is="TYPE_ICON[n.type] || InfoFilled" />
            </el-icon>
            <span class="notify-title">{{ n.title }}</span>
            <button class="notify-close" :title="t('notifications.dismiss')" @click="store.dismiss(n.id)">
              <el-icon :size="12"><Close /></el-icon>
            </button>
          </div>

          <div v-if="n.message" class="notify-msg">{{ n.message }}</div>

          <!-- 进度类：进度条 + 中止 -->
          <div v-if="n.cancellable || n.progress != null" class="notify-progress-row">
            <el-progress
              class="notify-progress"
              :percentage="n.progress ?? 0"
              :indeterminate="n.progress == null"
              :duration="1"
              :stroke-width="6"
              :show-text="false"
            />
            <el-button
              v-if="n.cancellable && n.status === 'active'"
              size="small"
              type="danger"
              plain
              class="notify-cancel-btn"
              @click="onCancel(n)"
            >
              {{ t('notifications.abort') }}
            </el-button>
          </div>

          <!-- 常规操作按钮 -->
          <div v-if="n.actions.length" class="notify-actions">
            <el-button
              v-for="a in n.actions"
              :key="a.label"
              size="small"
              :type="a.kind || 'default'"
              @click="onActionClick(n, a)"
            >
              {{ a.label }}
            </el-button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.notify-host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  /* 高于灯箱遮罩（5000），低于 Element Plus 弹层（config-provider z-index 6000） */
  z-index: 5500;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  pointer-events: none;
}

.notify-card {
  pointer-events: auto;
  background: #fff;
  border: 1px solid #e6e8eb;
  border-left: 3px solid var(--el-color-info);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  font-size: 13px;
  color: #1f2329;
}

html.dark .notify-card {
  background: #232426;
  border-color: #3a3b3d;
  color: #e5e6eb;
}

.notify-card.notify-info {
  border-left-color: var(--el-color-primary);
}
.notify-card.notify-success {
  border-left-color: var(--el-color-success);
}
.notify-card.notify-warning {
  border-left-color: var(--el-color-warning);
}
.notify-card.notify-error {
  border-left-color: var(--el-color-danger);
}
.notify-card.notify-progress {
  border-left-color: var(--el-color-primary);
}

.notify-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.notify-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--el-color-info);
  cursor: pointer;
}

.notify-close:hover {
  background: var(--panel-hover);
  color: var(--app-text);
}

.notify-msg {
  margin-top: 6px;
  color: #606266;
  word-break: break-all;
  line-height: 1.5;
}

html.dark .notify-msg {
  color: #a8abb2;
}

.notify-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.notify-progress {
  flex: 1;
  min-width: 0;
}

.notify-cancel-btn {
  flex-shrink: 0;
}

.notify-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

/* 弹出/收起动画 */
.notify-pop-enter-active,
.notify-pop-leave-active {
  transition: all 0.25s ease;
}

.notify-pop-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.notify-pop-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.notify-pop-leave-active {
  position: absolute;
  width: 100%;
}

/* 「动画 - 通知动画」关闭时：弹出/收起瞬间完成 */
.no-notify-anim .notify-pop-enter-active,
.no-notify-anim .notify-pop-leave-active {
  transition: none !important;
}
</style>
