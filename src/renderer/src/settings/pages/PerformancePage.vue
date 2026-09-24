<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCacheMaintenance } from '../../utils/use-cache-maintenance'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'
import MaintainTools from '../MaintainTools.vue'

const { t } = useI18n()

// ---------- 网格滚动与预加载 ----------
const GRID_PRELOAD_MAX = 3000
const gridBufferLazy = useSetting('imageBufferLazy')
const gridPreload = useSetting('imagePreload')
const preloadText = computed(() =>
  t('performance.preloadUnit', { n: Math.round(gridPreload.value) })
)

// ---------- 瀑布流卡片 ----------
const ZOOM_MAX_MIN = 1
// 上限 8：再大列宽过小、收益很低，且易触发极端列数导致的布局开销
const ZOOM_MAX_MAX = 8
const zoomMax = useSetting('zoomMax', {
  message: (v) => t('performance.zoomMaxSaved', { n: v })
})
// 卡片比例限制（默认开）：宽高比限制在 1:5 ~ 2:1
const imageTallCap = useSetting('imageTallCap')

// ---------- 缩略图缓存 ----------
const cacheSaved = { message: () => t('performance.cacheSaved') }
const cacheThumbWidth = useSetting('cacheThumbWidth', cacheSaved)
const widthText = computed(() => t('performance.thumbPx', { n: cacheThumbWidth.value }))
const cacheThumbQuality = useSetting('cacheThumbQuality', cacheSaved)
const cacheScanBatch = useSetting('cacheScanBatch', cacheSaved)
const cacheThumbBatch = useSetting('cacheThumbBatch', cacheSaved)

const THUMB_WORKERS_MAX = 64
const THUMB_TIMEOUT_MIN = 10000
const THUMB_TIMEOUT_MAX = 600000
const THUMB_SLOW_MIN = 1000
const THUMB_SLOW_MAX = 60000
const thumbWorkers = useSetting('cacheThumbWorkers', cacheSaved)
const thumbTimeout = useSetting('cacheThumbTimeout', cacheSaved)
const thumbSlowMs = useSetting('cacheThumbSlowMs', cacheSaved)

// ---------- 缓存生成方式 ----------
const sequentialRead = useSetting('cacheSequential')
const useCli = useSetting('cacheUseCli')
const cliExePath = useSetting('cacheCliExe', {
  normalize: (v) => String(v ?? '').trim()
})

// ---------- 缓存维护工具 ----------
const roots = ref([])
const maintainRootId = ref(null)
const {
  busy: maintainBusy,
  modes: MAINTAIN_MODES,
  start: startMaintain,
  attach: attachCacheProgress,
  detach: detachCacheProgress
} = useCacheMaintenance()

async function loadRoots() {
  try {
    roots.value = await window.api.rootsList()
  } catch {
    roots.value = []
  }
}

function maintain(mode) {
  const root = roots.value.find((r) => r.id === maintainRootId.value)
  if (root) startMaintain(root, mode)
}

onMounted(() => {
  loadRoots()
  attachCacheProgress()
})

onBeforeUnmount(() => {
  detachCacheProgress()
})
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.performance') }}</h2>
    <p class="page-desc">{{ t('performance.pageDesc') }}</p>

    <!-- 网格滚动与预加载 -->
    <SettingCard
      :title="t('performance.scrollTitle')"
      :reset-keys="['imageBufferLazy', 'imagePreload']"
    >
      <SettingRow :name="t('performance.bufferLazy')" :desc="t('performance.bufferLazyDesc')">
        <el-switch v-model="gridBufferLazy" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.preload')" :desc="t('performance.preloadDesc')">
        <div class="perf-slider-wrap">
          <el-slider
            v-model="gridPreload"
            :min="0"
            :max="GRID_PRELOAD_MAX"
            :step="100"
            :show-tooltip="false"
          />
        </div>
        <template #extra>
          <div class="perf-value">{{ preloadText }}</div>
        </template>
      </SettingRow>
    </SettingCard>

    <!-- 瀑布流卡片 -->
    <SettingCard :title="t('performance.cardTitle')" :reset-keys="['zoomMax', 'imageTallCap']">
      <SettingRow
        :name="t('performance.zoomMax')"
        :desc="t('performance.zoomMaxDesc', { min: ZOOM_MAX_MIN, max: ZOOM_MAX_MAX })"
      >
        <el-input-number v-model="zoomMax" :min="ZOOM_MAX_MIN" :max="ZOOM_MAX_MAX" size="default" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.imageTallCap')" :desc="t('performance.imageTallCapDesc')">
        <el-switch v-model="imageTallCap" />
      </SettingRow>
    </SettingCard>

    <!-- 缩略图缓存 -->
    <SettingCard
      :title="t('performance.thumbTitle')"
      :reset-keys="[
        'cacheThumbWidth',
        'cacheThumbQuality',
        'cacheScanBatch',
        'cacheThumbBatch',
        'cacheThumbWorkers',
        'cacheThumbTimeout',
        'cacheThumbSlowMs'
      ]"
    >
      <SettingRow :name="t('performance.thumbWidth')" :desc="t('performance.thumbDesc')">
        <el-input-number
          v-model="cacheThumbWidth"
          :min="64"
          :max="4096"
          :step="32"
          size="default"
        />
        <template #extra>
          <div class="perf-value">{{ widthText }}</div>
        </template>
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.thumbQuality')" :desc="t('performance.thumbQualityDesc')">
        <el-input-number v-model="cacheThumbQuality" :min="1" :max="100" size="default" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.scanBatch')" :desc="t('performance.scanBatchDesc')">
        <el-input-number v-model="cacheScanBatch" :min="10" :max="1000" :step="10" size="default" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.thumbBatch')" :desc="t('performance.thumbBatchDesc')">
        <el-input-number v-model="cacheThumbBatch" :min="10" :max="500" :step="10" size="default" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.thumbWorkers')" :desc="t('performance.thumbWorkersDesc')">
        <el-input-number
          v-model="thumbWorkers"
          :min="0"
          :max="THUMB_WORKERS_MAX"
          :step="1"
          size="default"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.thumbTimeout')" :desc="t('performance.thumbTimeoutDesc')">
        <el-input-number
          v-model="thumbTimeout"
          :min="THUMB_TIMEOUT_MIN"
          :max="THUMB_TIMEOUT_MAX"
          :step="10000"
          size="default"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.thumbSlow')" :desc="t('performance.thumbSlowDesc')">
        <el-input-number
          v-model="thumbSlowMs"
          :min="THUMB_SLOW_MIN"
          :max="THUMB_SLOW_MAX"
          :step="500"
          size="default"
        />
      </SettingRow>

      <p class="perf-footnote">{{ t('performance.thumbApplyHint') }}</p>
    </SettingCard>

    <!-- 缓存生成方式 -->
    <SettingCard
      :title="t('performance.cacheGenTitle')"
      :desc="t('performance.cacheDesc')"
      :reset-keys="['cacheSequential', 'cacheUseCli', 'cacheCliExe']"
    >
      <SettingRow :name="t('performance.cacheUseCli')" :desc="t('performance.cacheUseCliDesc')">
        <el-switch v-model="useCli" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('performance.cacheCliExe')" :desc="t('performance.cacheCliExeDesc')">
        <el-input
          v-model="cliExePath"
          :disabled="!useCli"
          placeholder="image_compresser.exe"
          clearable
          size="default"
          class="cli-exe-input"
        />
      </SettingRow>

      <el-divider />

      <SettingRow
        :name="t('performance.cacheSequential')"
        :desc="t('performance.cacheSequentialDesc')"
      >
        <el-switch v-model="sequentialRead" />
      </SettingRow>
    </SettingCard>

    <!-- 缓存维护工具 -->
    <MaintainTools
      v-model="maintainRootId"
      :title="t('roots.maintainTools')"
      :desc="t('roots.maintainDesc')"
      :running-text="t('roots.taskRunning')"
      :roots="roots"
      :busy="maintainBusy"
      :modes="MAINTAIN_MODES"
      :placeholder="t('roots.selectMaintainRoot')"
      :select-root-first="t('roots.selectRootFirst')"
      no-root-tooltip
      @run="maintain"
    />
  </div>
</template>

<style scoped>
.perf-value {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: 600;
}

.perf-slider-wrap {
  width: 240px;
}

.perf-footnote {
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.cli-exe-input {
  width: 300px;
}
</style>
