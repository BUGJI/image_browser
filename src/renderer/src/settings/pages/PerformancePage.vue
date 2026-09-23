<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 性能页：跟手度调优。加载行为改动即时生效，缩略图宽度需重建缓存。

const PRELOAD_MIN = 0
const PRELOAD_MAX = 2000
const PRELOAD_STEP = 100
const PRELOAD_DEFAULT = 900

const WIDTH_MIN = 64
const WIDTH_MAX = 4096
const WIDTH_STEP = 32
const WIDTH_DEFAULT = 512

const bufferLazy = ref(true)
const preload = ref(PRELOAD_DEFAULT)
const thumbWidth = ref(WIDTH_DEFAULT)

const preloadText = computed(() => t('performance.preloadUnit', { n: Math.round(preload.value) }))
const widthText = computed(() => t('performance.thumbPx', { n: thumbWidth.value }))

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

let offSettingsChanged = null

onMounted(async () => {
  const lb = await window.api.getSetting('imageBufferLazy', 'true')
  bufferLazy.value = lb !== 'false'

  preload.value = clampNum(
    await window.api.getSetting('imagePreload', String(PRELOAD_DEFAULT)),
    PRELOAD_MIN,
    PRELOAD_MAX,
    PRELOAD_DEFAULT
  )

  thumbWidth.value = clampNum(
    await window.api.getSetting('cacheThumbWidth', String(WIDTH_DEFAULT)),
    WIDTH_MIN,
    WIDTH_MAX,
    WIDTH_DEFAULT
  )

  // 主窗口/设置窗口都可能修改，保持同步
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'imageBufferLazy') bufferLazy.value = value !== 'false'
    else if (key === 'imagePreload') {
      preload.value = clampNum(value, PRELOAD_MIN, PRELOAD_MAX, PRELOAD_DEFAULT)
    } else if (key === 'cacheThumbWidth') {
      thumbWidth.value = clampNum(value, WIDTH_MIN, WIDTH_MAX, WIDTH_DEFAULT)
    }
  })
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
})

async function save(key, value) {
  try {
    await window.api.setSetting(key, value)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onBufferLazyChange(v) {
  save('imageBufferLazy', v ? 'true' : 'false')
}

function onPreloadChange(v) {
  save('imagePreload', String(Math.round(v)))
}

function onThumbWidthChange(v) {
  save('cacheThumbWidth', String(Math.round(v)))
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.performance') }}</h2>
    <p class="page-desc">{{ t('performance.pageDesc') }}</p>

    <el-card class="perf-card" shadow="never">
      <template #header>{{ t('performance.scrollTitle') }}</template>

      <div class="perf-row">
        <div class="perf-label">
          <div class="perf-name">{{ t('performance.bufferLazy') }}</div>
          <div class="perf-desc">{{ t('performance.bufferLazyDesc') }}</div>
        </div>
        <el-switch v-model="bufferLazy" @change="onBufferLazyChange" />
      </div>

      <el-divider />

      <div class="perf-row">
        <div class="perf-label">
          <div class="perf-name">{{ t('performance.preload') }}</div>
          <div class="perf-desc">{{ t('performance.preloadDesc') }}</div>
          <div class="perf-value">{{ preloadText }}</div>
        </div>
        <div class="perf-slider-wrap">
          <el-slider
            v-model="preload"
            :min="PRELOAD_MIN"
            :max="PRELOAD_MAX"
            :step="PRELOAD_STEP"
            :show-tooltip="false"
            @change="onPreloadChange"
          />
        </div>
      </div>
    </el-card>

    <el-card class="perf-card" shadow="never">
      <template #header>{{ t('performance.thumbTitle') }}</template>

      <div class="perf-row">
        <div class="perf-label">
          <div class="perf-name">{{ t('performance.thumbTitle') }}</div>
          <div class="perf-desc">{{ t('performance.thumbDesc') }}</div>
          <div class="perf-value">{{ widthText }}</div>
        </div>
        <el-input-number
          v-model="thumbWidth"
          :min="WIDTH_MIN"
          :max="WIDTH_MAX"
          :step="WIDTH_STEP"
          size="default"
          @change="onThumbWidthChange"
        />
      </div>

      <div class="perf-footnote">{{ t('performance.thumbApplyHint') }}</div>
      <div class="perf-footnote">{{ t('performance.advancedHint') }}</div>
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
  max-width: 720px;
  line-height: 1.6;
}

.perf-card {
  max-width: 720px;
  margin-bottom: 24px;
}

.perf-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.perf-label {
  min-width: 0;
}

.perf-name {
  font-size: 14px;
  font-weight: 600;
}

.perf-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.perf-value {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: 600;
}

.perf-slider-wrap {
  flex-shrink: 0;
  width: 240px;
}

.perf-footnote {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
</style>
