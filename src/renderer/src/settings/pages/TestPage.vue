<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationsStore } from '../../stores/notifications'

const { t } = useI18n()
const store = useNotificationsStore()
const timers = []

onBeforeUnmount(() => {
  timers.forEach((t) => clearInterval(t))
})

// ---------- 触发器：进度通知（模拟，可中止） ----------
function triggerProgress() {
  let timer = null
  const id = store.add({
    type: 'progress',
    title: t('test.mockProgressTitle'),
    message: t('test.mockStart'),
    cancellable: true,
    onCancel: () => {
      if (timer) clearInterval(timer)
      store.finish(id, 'aborted', { message: t('test.mockUserAbort') })
    }
  })
  let p = 0
  timer = setInterval(() => {
    p += 8
    if (p >= 100) {
      clearInterval(timer)
      store.finish(id, 'done', { message: t('test.mockDone') })
      return
    }
    store.update(id, { message: t('test.mockProcessing', { p }) })
    store.updateProgress(id, p)
  }, 300)
  timers.push(timer)
}

// ---------- 触发器：带 取消/确定 按钮 ----------
function triggerConfirm() {
  store.add({
    type: 'info',
    title: t('test.mockConfirmTitle'),
    message: t('test.mockConfirmMsg'),
    actions: [
      {
        label: t('common.cancel'),
        kind: 'default',
        onClick: () => store.add({ type: 'info', title: t('test.mockCancelled'), message: t('test.mockCancelMsg') })
      },
      {
        label: t('common.confirm'),
        kind: 'primary',
        onClick: () => store.add({ type: 'success', title: t('test.mockConfirmed'), message: t('test.mockConfirmClickMsg') })
      }
    ]
  })
}

// ---------- 触发器：带 忽略/查看 按钮 ----------
function triggerView() {
  store.add({
    type: 'warning',
    title: t('test.mockFoundTitle'),
    message: t('test.mockViewMsg'),
    actions: [
      { label: t('test.mockIgnore'), kind: 'default', onClick: () => {} },
      {
        label: t('test.mockView'),
        kind: 'primary',
        onClick: () => store.add({ type: 'success', title: t('test.mockViewCallback'), message: t('test.mockViewClickMsg') })
      }
    ]
  })
}

// ---------- 触发器：纯提示（自动收起） ----------
function triggerInfo() {
  store.add({ type: 'info', title: t('test.mockInfoTitle'), message: t('test.mockInfoMsg') })
}

function triggerSuccess() {
  store.add({ type: 'success', title: t('test.mockSuccessTitle'), message: t('test.mockSuccessMsg') })
}

function triggerWarning() {
  store.add({ type: 'warning', title: t('test.mockWarningTitle'), message: t('test.mockWarningMsg') })
}

function triggerError() {
  store.add({ type: 'error', title: t('test.mockErrorTitle'), message: t('test.mockErrorMsg') })
}

// ---------- 当前通知预览 ----------
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
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
</script>

<template>
  <div class="test-page">
    <h2 class="page-title">{{ t('settings.test') }}</h2>
    <p class="page-desc">{{ t('test.pageDesc') }}</p>

    <el-card class="test-card" shadow="never">
      <template #header>{{ t('test.notifyTriggers') }}</template>
      <div class="trigger-grid">
        <el-button type="primary" plain @click="triggerProgress">{{ t('test.progress') }}</el-button>
        <el-button @click="triggerConfirm">{{ t('test.confirm') }}</el-button>
        <el-button type="warning" plain @click="triggerView">{{ t('test.view') }}</el-button>
        <el-button @click="triggerInfo">{{ t('test.info') }}</el-button>
        <el-button type="success" plain @click="triggerSuccess">{{ t('test.success') }}</el-button>
        <el-button type="warning" @click="triggerWarning">{{ t('test.warning') }}</el-button>
        <el-button type="danger" @click="triggerError">{{ t('test.error') }}</el-button>
        <el-button type="danger" plain @click="store.clearAll()">{{ t('test.clearAll') }}</el-button>
      </div>
    </el-card>

    <el-card class="test-card" shadow="never">
      <template #header>
        <span>{{ t('test.currentNotify', { count: store.items.length }) }}</span>
      </template>
      <el-empty
        v-if="!store.items.length"
        :image-size="60"
        :description="t('test.noNotify')"
      />
      <div v-else class="preview-list">
        <div v-for="n in store.items" :key="n.id" class="preview-item">
          <span class="preview-title">{{ n.title }}</span>
          <span class="preview-msg">{{ n.message }}</span>
          <el-tag v-if="statusTag(n)" size="small" :type="statusTag(n).type">
            {{ statusTag(n).label }}
          </el-tag>
          <span class="preview-time">{{ fmtTime(n.createdAt) }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.test-page {
  max-width: 720px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 20px;
}

.page-desc {
  margin: 0 0 16px;
  color: #999;
  font-size: 13px;
}

.test-card {
  margin-bottom: 16px;
}

.trigger-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.preview-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}

.preview-title {
  font-weight: 600;
  flex-shrink: 0;
}

.preview-msg {
  flex: 1;
  min-width: 0;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-time {
  color: #aaa;
  font-size: 12px;
  flex-shrink: 0;
}
</style>
