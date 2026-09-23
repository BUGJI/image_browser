<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  SHORTCUTS_KEY,
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  eventToCombo,
  combosEqual
} from '../../utils/shortcuts'

const { t } = useI18n()

// 动作定义：label/desc 取 i18n
const ACTIONS = [
  { id: 'copyFile', label: () => t('shortcuts.copyFile'), desc: () => t('shortcuts.copyFileDesc') },
  {
    id: 'copyImage',
    label: () => t('shortcuts.copyImage'),
    desc: () => t('shortcuts.copyImageDesc')
  }
]

const shortcuts = ref({ ...DEFAULT_SHORTCUTS })
const recording = ref('') // 正在捕获的动作 id，空表示无

// 灯箱滚轮行为：zoom = 缩放图片；navigate = 切换上一张/下一张
const wheelAction = ref('zoom')
const WHEEL_OPTIONS = computed(() => [
  { value: 'zoom', label: t('shortcuts.wheelZoom'), desc: t('shortcuts.wheelZoomDesc') },
  { value: 'navigate', label: t('shortcuts.wheelNavigate'), desc: t('shortcuts.wheelNavigateDesc') }
])

onMounted(async () => {
  shortcuts.value = await loadShortcuts()
  const wa = await window.api.getSetting('lightboxWheelAction', 'zoom')
  wheelAction.value = ['zoom', 'navigate'].includes(wa) ? wa : 'zoom'
  window.addEventListener('keydown', onCaptureKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKeydown, true)
})

async function onWheelActionChange(v) {
  try {
    await window.api.setSetting('lightboxWheelAction', v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function startRecord(actionId) {
  recording.value = actionId
}

function cancelRecord() {
  recording.value = ''
}

async function save() {
  try {
    await window.api.setSetting(SHORTCUTS_KEY, JSON.stringify(shortcuts.value))
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function resetDefaults() {
  shortcuts.value = { ...DEFAULT_SHORTCUTS }
  await save()
}

// 捕获模式下的按键处理
async function onCaptureKeydown(e) {
  if (!recording.value) return
  const combo = eventToCombo(e)
  if (!combo) {
    // Esc 取消录制；纯修饰键忽略
    if (e.key === 'Escape') cancelRecord()
    return
  }
  e.preventDefault()
  e.stopPropagation()

  // 检查是否与另一动作冲突
  const conflict = ACTIONS.find((a) => a.id !== recording.value && combosEqual(shortcuts.value[a.id], combo))
  if (conflict) {
    ElMessage.warning(t('shortcuts.conflict', { action: conflict.label() }))
    return
  }

  shortcuts.value[recording.value] = combo
  recording.value = ''
  await save()
}

function displayCombo(id) {
  return shortcuts.value[id] || '-'
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.shortcuts') }}</h2>
    <p class="page-desc">{{ t('shortcuts.pageDesc') }}</p>

    <el-card class="shortcuts-card" shadow="never">
      <div class="shortcut-row" v-for="a in ACTIONS" :key="a.id">
        <div class="shortcut-label">
          <div class="shortcut-name">{{ a.label() }}</div>
          <div class="shortcut-desc">{{ a.desc() }}</div>
        </div>
        <div class="shortcut-control">
          <button
            class="shortcut-key"
            :class="{ 'shortcut-key-recording': recording === a.id }"
            @click="startRecord(a.id)"
          >
            <template v-if="recording === a.id">
              {{ t('shortcuts.pressKeys') }}…
            </template>
            <template v-else>
              <kbd class="key-box" v-if="shortcuts[a.id]">{{ shortcuts[a.id] }}</kbd>
              <span v-else class="key-empty">{{ t('shortcuts.unbound') }}</span>
            </template>
          </button>
          <el-button v-if="recording === a.id" link size="small" @click="cancelRecord">
            {{ t('common.cancel') }}
          </el-button>
        </div>
      </div>

      <el-alert type="info" :closable="false" class="tip" :title="t('shortcuts.recordTip')" />
      <div class="shortcut-actions">
        <el-button size="small" @click="resetDefaults">{{ t('shortcuts.reset') }}</el-button>
      </div>
    </el-card>

    <el-card class="shortcuts-card wheel-card" shadow="never">
      <template #header>{{ t('shortcuts.wheelSection') }}</template>
      <div class="shortcut-row">
        <div class="shortcut-label">
          <div class="shortcut-name">{{ t('shortcuts.wheelAction') }}</div>
          <div class="shortcut-desc">{{ t('shortcuts.wheelActionDesc') }}</div>
        </div>
        <el-select v-model="wheelAction" class="wheel-select" @change="onWheelActionChange">
          <el-option
            v-for="o in WHEEL_OPTIONS"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
      </div>
      <p class="wheel-tip">
        {{ WHEEL_OPTIONS.find((o) => o.value === wheelAction)?.desc }}
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.page h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.page-desc {
  color: #999;
  font-size: 13px;
  margin-bottom: 24px;
}

.shortcuts-card {
  max-width: 720px;
}

.shortcut-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.shortcut-row:first-child {
  padding-top: 0;
}

.shortcut-name {
  font-size: 14px;
  font-weight: 600;
}

.shortcut-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.shortcut-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.shortcut-key {
  min-width: 140px;
  height: 34px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.shortcut-key:hover {
  border-color: var(--el-color-primary);
}

.shortcut-key-recording {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  50% {
    opacity: 0.45;
  }
}

.key-box {
  font-family: inherit;
  font-size: 12px;
  padding: 1px 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.key-empty {
  color: var(--el-text-color-placeholder);
}

.shortcuts-card + .wheel-card {
  margin-top: 16px;
}

.wheel-select {
  width: 180px;
  flex-shrink: 0;
}

.wheel-tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: #909399;
}

.tip {
  margin-top: 16px;
}

.shortcut-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
