<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { rootDisplayName as displayName, indexButtonType as buttonType } from '../../utils/roots'
import { useCacheMaintenance } from '../../utils/use-cache-maintenance'

const { t } = useI18n()

// 开发者选项总开关（关闭时下方所有项目禁用）
const devEnabled = ref(false)
// 网页开发者工具按钮触发（每次点击等效于关闭再打开）
// 设置 - 测试 栏目显隐（默认隐藏）
const showTest = ref(false)
// 显示隐藏功能（默认关闭）：开启后显示 AI 搜索等隐藏栏目
const showHidden = ref(false)
// 瀑布流缩放滑块最大值
const zoomMax = ref(2)
// 卡片比例限制（默认开）：宽高比限制在 1:5 ~ 2:1
const imageTallCap = ref(true)
const ZOOM_MAX_MIN = 1
// 上限 8：再大列宽过小、收益很低，且易触发极端列数导致的布局开销
const ZOOM_MAX_MAX = 8

// 灯箱缩放限制
const LIGHT_ZOOM_MIN_BOUND = 0.1
const LIGHT_ZOOM_MAX_BOUND = 100
const lightZoomMin = ref(0.5)
const lightZoomMax = ref(8)
const lightZoomStep = ref(1.2)

// 缓存维护参数
const cacheThumbWidth = ref(512)
const cacheThumbQuality = ref(80)
const cacheScanBatch = ref(100)
const cacheThumbBatch = ref(100)

// 缓存并发/超时/慢图告警
const THUMB_WORKERS_DEFAULT = 0 // 0 = 自动按核数
const THUMB_WORKERS_MAX = 64
const THUMB_TIMEOUT_DEFAULT = 120000
const THUMB_TIMEOUT_MIN = 10000
const THUMB_TIMEOUT_MAX = 600000
const THUMB_SLOW_DEFAULT = 3000
const THUMB_SLOW_MIN = 1000
const THUMB_SLOW_MAX = 60000
const thumbWorkers = ref(THUMB_WORKERS_DEFAULT)
const thumbTimeout = ref(THUMB_TIMEOUT_DEFAULT)
const thumbSlowMs = ref(THUMB_SLOW_DEFAULT)

// 缓存任务分配：true = 连续读取（顺序分配，机械硬盘友好）；false = 跨目录打散
const sequentialRead = ref(true)
// 使用外部转换器 image_compresser.exe 生成缩略图
const useCli = ref(false)
const cliExePath = ref('')

// 网格滚动性能（原「性能」页选项，已并入开发者选项）
const GRID_PRELOAD_DEFAULT = 900
const GRID_PRELOAD_MAX = 3000
const gridBufferLazy = ref(true)
const gridPreload = ref(GRID_PRELOAD_DEFAULT)

// 记录日志开关
const loggingEnabled = ref(false)

// ---------- 缓存维护工具（原「根目录」页移入） ----------
const roots = ref([])
const maintainRootId = ref(null) // 选中的根目录

// 维护任务的进度/通知逻辑抽到公共 composable（根目录页的一键「更新缓存」也复用）
const {
  busy: maintainBusy,
  modes: MAINTAIN_MODES,
  start: startMaintain,
  attach: attachCacheProgress,
  detach: detachCacheProgress
} = useCacheMaintenance()

let offSettingsChanged = null

const disabled = computed(() => !devEnabled.value)

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

onMounted(async () => {
  devEnabled.value = (await window.api.getSetting('devOptions', 'false')) === 'true'
  showTest.value = (await window.api.getSetting('showTest', 'false')) === 'true'
  showHidden.value = (await window.api.getSetting('showHidden', 'false')) === 'true'
  const zm = parseFloat(await window.api.getSetting('zoomMax', '2'))
  zoomMax.value = Number.isFinite(zm) ? clampZoomMax(zm) : 2
  imageTallCap.value = (await window.api.getSetting('imageTallCap', 'true')) !== 'false'

  lightZoomMin.value = clampNum(
    await window.api.getSetting('lightboxZoomMin', '0.5'),
    LIGHT_ZOOM_MIN_BOUND,
    LIGHT_ZOOM_MAX_BOUND,
    0.5
  )
  lightZoomMax.value = clampNum(
    await window.api.getSetting('lightboxZoomMax', '8'),
    LIGHT_ZOOM_MIN_BOUND,
    LIGHT_ZOOM_MAX_BOUND,
    8
  )
  lightZoomStep.value = clampNum(
    await window.api.getSetting('lightboxZoomStep', '1.2'),
    1.01,
    2,
    1.2
  )

  cacheThumbWidth.value = clampNum(
    await window.api.getSetting('cacheThumbWidth', '512'),
    64,
    4096,
    512
  )
  cacheThumbQuality.value = clampNum(
    await window.api.getSetting('cacheThumbQuality', '80'),
    1,
    100,
    80
  )
  cacheScanBatch.value = clampNum(
    await window.api.getSetting('cacheScanBatch', '100'),
    10,
    1000,
    100
  )
  cacheThumbBatch.value = clampNum(
    await window.api.getSetting('cacheThumbBatch', '100'),
    10,
    500,
    100
  )

  thumbWorkers.value = clampNum(
    await window.api.getSetting('cacheThumbWorkers', String(THUMB_WORKERS_DEFAULT)),
    THUMB_WORKERS_DEFAULT,
    THUMB_WORKERS_MAX,
    THUMB_WORKERS_DEFAULT
  )
  thumbTimeout.value = clampNum(
    await window.api.getSetting('cacheThumbTimeout', String(THUMB_TIMEOUT_DEFAULT)),
    THUMB_TIMEOUT_MIN,
    THUMB_TIMEOUT_MAX,
    THUMB_TIMEOUT_DEFAULT
  )
  thumbSlowMs.value = clampNum(
    await window.api.getSetting('cacheThumbSlowMs', String(THUMB_SLOW_DEFAULT)),
    THUMB_SLOW_MIN,
    THUMB_SLOW_MAX,
    THUMB_SLOW_DEFAULT
  )
  sequentialRead.value = (await window.api.getSetting('cacheSequential', 'true')) !== 'false'
  useCli.value = (await window.api.getSetting('cacheUseCli', 'false')) === 'true'
  cliExePath.value = await window.api.getSetting('cacheCliExe', '')
  gridBufferLazy.value = (await window.api.getSetting('imageBufferLazy', 'true')) !== 'false'
  gridPreload.value = clampNum(
    await window.api.getSetting('imagePreload', String(GRID_PRELOAD_DEFAULT)),
    0,
    GRID_PRELOAD_MAX,
    GRID_PRELOAD_DEFAULT
  )

  loggingEnabled.value = (await window.api.getSetting('loggingEnabled', 'false')) === 'true'

  // 主窗口可能修改这些设置，保持同步
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'devOptions') devEnabled.value = value === 'true'
    else if (key === 'showTest') showTest.value = value === 'true'
    else if (key === 'showHidden') showHidden.value = value === 'true'
    else if (key === 'zoomMax') {
      const zm = parseFloat(value)
      if (Number.isFinite(zm)) zoomMax.value = clampZoomMax(zm)
    } else if (key === 'imageTallCap') imageTallCap.value = value !== 'false'
    else if (key === 'lightboxZoomMin')
      lightZoomMin.value = clampNum(value, LIGHT_ZOOM_MIN_BOUND, LIGHT_ZOOM_MAX_BOUND, 0.5)
    else if (key === 'lightboxZoomMax')
      lightZoomMax.value = clampNum(value, LIGHT_ZOOM_MIN_BOUND, LIGHT_ZOOM_MAX_BOUND, 8)
    else if (key === 'lightboxZoomStep') lightZoomStep.value = clampNum(value, 1.01, 2, 1.2)
    else if (key === 'cacheThumbWidth') cacheThumbWidth.value = clampNum(value, 64, 4096, 512)
    else if (key === 'cacheThumbQuality') cacheThumbQuality.value = clampNum(value, 1, 100, 80)
    else if (key === 'cacheScanBatch') cacheScanBatch.value = clampNum(value, 10, 1000, 100)
    else if (key === 'cacheThumbBatch') cacheThumbBatch.value = clampNum(value, 10, 500, 100)
    else if (key === 'cacheThumbWorkers')
      thumbWorkers.value = clampNum(
        value,
        THUMB_WORKERS_DEFAULT,
        THUMB_WORKERS_MAX,
        THUMB_WORKERS_DEFAULT
      )
    else if (key === 'cacheThumbTimeout')
      thumbTimeout.value = clampNum(
        value,
        THUMB_TIMEOUT_MIN,
        THUMB_TIMEOUT_MAX,
        THUMB_TIMEOUT_DEFAULT
      )
    else if (key === 'cacheThumbSlowMs')
      thumbSlowMs.value = clampNum(value, THUMB_SLOW_MIN, THUMB_SLOW_MAX, THUMB_SLOW_DEFAULT)
    else if (key === 'cacheSequential') sequentialRead.value = value !== 'false'
    else if (key === 'cacheUseCli') useCli.value = value === 'true'
    else if (key === 'cacheCliExe') cliExePath.value = value || ''
    else if (key === 'imageBufferLazy') gridBufferLazy.value = value !== 'false'
    else if (key === 'imagePreload')
      gridPreload.value = clampNum(value, 0, GRID_PRELOAD_MAX, GRID_PRELOAD_DEFAULT)
    else if (key === 'loggingEnabled') loggingEnabled.value = value === 'true'
  })

  // 缓存维护：根目录列表 + 进度监听
  loadRoots()
  attachCacheProgress()
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
  detachCacheProgress()
})

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampZoomMax(v) {
  if (!Number.isFinite(v)) return 2
  return Math.min(ZOOM_MAX_MAX, Math.max(ZOOM_MAX_MIN, v))
}

async function onMasterChange(v) {
  try {
    await window.api.setSetting('devOptions', v ? 'true' : 'false')
    if (v) ElMessage.success(t('devOptions.enabled'))
    else ElMessage.info(t('devOptions.disabled'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

// 每次点击：关闭再重新打开 DevTools
async function onRestartDevtools() {
  try {
    await window.api.restartDevtools()
    ElMessage.success(t('devOptions.devtoolsReopened'))
  } catch {
    ElMessage.error(t('common.operationFailed'))
  }
}

async function onShowTestChange(v) {
  try {
    await window.api.setSetting('showTest', v ? 'true' : 'false')
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onShowHiddenChange(v) {
  try {
    await window.api.setSetting('showHidden', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onZoomMaxChange(v) {
  await window.api.setSetting('zoomMax', String(clampZoomMax(v)))
  ElMessage.success(t('devOptions.zoomMaxSaved', { n: clampZoomMax(v) }))
}

async function onImageTallCapChange(v) {
  try {
    await window.api.setSetting('imageTallCap', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function saveLightZoomSetting(key, v, min, max, fallback, decimals) {
  const n = clampNum(v, min, max, fallback)
  const val = Number(n.toFixed(decimals ?? 2))
  try {
    await window.api.setSetting(key, String(val))
    ElMessage.success(t('devOptions.lightZoomSaved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onLightZoomMinChange(v) {
  saveLightZoomSetting('lightboxZoomMin', v, LIGHT_ZOOM_MIN_BOUND, LIGHT_ZOOM_MAX_BOUND, 0.5, 1)
}
function onLightZoomMaxChange(v) {
  saveLightZoomSetting('lightboxZoomMax', v, LIGHT_ZOOM_MIN_BOUND, LIGHT_ZOOM_MAX_BOUND, 8, 1)
}
function onLightZoomStepChange(v) {
  saveLightZoomSetting('lightboxZoomStep', v, 1.01, 2, 1.2, 2)
}

async function saveCacheSetting(key, v, min, max, fallback) {
  const n = clampNum(v, min, max, fallback)
  try {
    await window.api.setSetting(key, String(n))
    ElMessage.success(t('devOptions.cacheSaved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onCacheThumbWidthChange(v) {
  saveCacheSetting('cacheThumbWidth', v, 64, 4096, 512)
}
function onCacheThumbQualityChange(v) {
  saveCacheSetting('cacheThumbQuality', v, 1, 100, 80)
}
function onCacheScanBatchChange(v) {
  saveCacheSetting('cacheScanBatch', v, 10, 1000, 100)
}
function onCacheThumbBatchChange(v) {
  saveCacheSetting('cacheThumbBatch', v, 10, 500, 100)
}
function onThumbWorkersChange(v) {
  saveCacheSetting(
    'cacheThumbWorkers',
    v,
    THUMB_WORKERS_DEFAULT,
    THUMB_WORKERS_MAX,
    THUMB_WORKERS_DEFAULT
  )
}
function onThumbTimeoutChange(v) {
  saveCacheSetting(
    'cacheThumbTimeout',
    v,
    THUMB_TIMEOUT_MIN,
    THUMB_TIMEOUT_MAX,
    THUMB_TIMEOUT_DEFAULT
  )
}
function onThumbSlowChange(v) {
  saveCacheSetting('cacheThumbSlowMs', v, THUMB_SLOW_MIN, THUMB_SLOW_MAX, THUMB_SLOW_DEFAULT)
}

async function onSequentialReadChange(v) {
  try {
    await window.api.setSetting('cacheSequential', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onUseCliChange(v) {
  try {
    await window.api.setSetting('cacheUseCli', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onCliExePathChange(v) {
  try {
    await window.api.setSetting('cacheCliExe', String(v || '').trim())
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onGridBufferLazyChange(v) {
  try {
    await window.api.setSetting('imageBufferLazy', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onGridPreloadChange(v) {
  saveCacheSetting('imagePreload', v, 0, GRID_PRELOAD_MAX, GRID_PRELOAD_DEFAULT)
}

async function onLoggingChange(v) {
  try {
    await window.api.setSetting('loggingEnabled', v ? 'true' : 'false')
    await window.api.loggingSet(v)
    ElMessage.success(v ? t('devOptions.loggingOn') : t('devOptions.loggingOff'))
  } catch {
    ElMessage.error(t('common.operationFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.devOptions') }}</h2>
    <p class="page-desc">{{ t('devOptions.pageDesc') }}</p>

    <el-card class="dev-card" shadow="never">
      <div class="master-row">
        <div class="master-label">
          <div class="master-name">{{ t('devOptions.enableMaster') }}</div>
          <div class="master-desc">{{ t('devOptions.masterDesc') }}</div>
        </div>
        <el-switch v-model="devEnabled" @change="onMasterChange" />
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>{{ t('devOptions.tools') }}</template>
      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.devtools') }}</div>
          <div class="dev-desc">{{ t('devOptions.devtoolsDesc') }}</div>
        </div>
        <el-button :disabled="disabled" type="primary" plain @click="onRestartDevtools">
          {{ t('devOptions.reopen') }}
        </el-button>
      </div>

      <el-divider />

      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.showTest') }}</div>
          <div class="dev-desc">{{ t('devOptions.showTestDesc') }}</div>
        </div>
        <el-switch v-model="showTest" :disabled="disabled" @change="onShowTestChange" />
      </div>

      <el-divider />

      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.showHidden') }}</div>
          <div class="dev-desc">{{ t('devOptions.showHiddenDesc') }}</div>
        </div>
        <el-switch v-model="showHidden" :disabled="disabled" @change="onShowHiddenChange" />
      </div>

      <el-divider />

      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.logging') }}</div>
          <div class="dev-desc">{{ t('devOptions.loggingDesc') }}</div>
        </div>
        <el-switch v-model="loggingEnabled" :disabled="disabled" @change="onLoggingChange" />
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>{{ t('devOptions.zoomTitle') }}</template>
      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.zoomMax') }}</div>
          <div class="dev-desc">
            {{ t('devOptions.zoomMaxDesc', { min: ZOOM_MAX_MIN, max: ZOOM_MAX_MAX }) }}
          </div>
        </div>
        <el-input-number
          v-model="zoomMax"
          :min="ZOOM_MAX_MIN"
          :max="ZOOM_MAX_MAX"
          :disabled="disabled"
          size="default"
          @change="onZoomMaxChange"
        />
      </div>

      <el-divider />

      <div class="dev-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.imageTallCap') }}</div>
          <div class="dev-desc">{{ t('devOptions.imageTallCapDesc') }}</div>
        </div>
        <el-switch v-model="imageTallCap" :disabled="disabled" @change="onImageTallCapChange" />
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>{{ t('devOptions.lightZoomTitle') }}</template>
      <div class="dev-desc-block">{{ t('devOptions.lightZoomDesc') }}</div>

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.lightZoomMin') }}</div>
          <div class="dev-desc">{{ t('devOptions.lightZoomMinDesc') }}</div>
        </div>
        <el-input-number
          v-model="lightZoomMin"
          :min="LIGHT_ZOOM_MIN_BOUND"
          :max="LIGHT_ZOOM_MAX_BOUND"
          :step="0.1"
          :precision="1"
          :disabled="disabled"
          size="default"
          @change="onLightZoomMinChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.lightZoomMax') }}</div>
          <div class="dev-desc">{{ t('devOptions.lightZoomMaxDesc') }}</div>
        </div>
        <el-input-number
          v-model="lightZoomMax"
          :min="LIGHT_ZOOM_MIN_BOUND"
          :max="LIGHT_ZOOM_MAX_BOUND"
          :step="1"
          :precision="1"
          :disabled="disabled"
          size="default"
          @change="onLightZoomMaxChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.lightZoomStep') }}</div>
          <div class="dev-desc">{{ t('devOptions.lightZoomStepDesc') }}</div>
        </div>
        <el-input-number
          v-model="lightZoomStep"
          :min="1.01"
          :max="2"
          :step="0.05"
          :precision="2"
          :disabled="disabled"
          size="default"
          @change="onLightZoomStepChange"
        />
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>{{ t('devOptions.cacheTitle') }}</template>
      <div class="dev-desc-block">{{ t('devOptions.cacheDesc') }}</div>

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.cacheUseCli') }}</div>
          <div class="dev-desc">{{ t('devOptions.cacheUseCliDesc') }}</div>
        </div>
        <el-switch v-model="useCli" :disabled="disabled" @change="onUseCliChange" />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.cacheCliExe') }}</div>
          <div class="dev-desc">{{ t('devOptions.cacheCliExeDesc') }}</div>
        </div>
        <el-input
          v-model="cliExePath"
          :disabled="disabled || !useCli"
          placeholder="image_compresser.exe"
          clearable
          size="default"
          class="cli-exe-input"
          @change="onCliExePathChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.cacheSequential') }}</div>
          <div class="dev-desc">{{ t('devOptions.cacheSequentialDesc') }}</div>
        </div>
        <el-switch v-model="sequentialRead" :disabled="disabled" @change="onSequentialReadChange" />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbWidth') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbWidthDesc') }}</div>
        </div>
        <el-input-number
          v-model="cacheThumbWidth"
          :min="64"
          :max="4096"
          :step="32"
          :disabled="disabled"
          size="default"
          @change="onCacheThumbWidthChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbQuality') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbQualityDesc') }}</div>
        </div>
        <el-input-number
          v-model="cacheThumbQuality"
          :min="1"
          :max="100"
          :disabled="disabled"
          size="default"
          @change="onCacheThumbQualityChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.scanBatch') }}</div>
          <div class="dev-desc">{{ t('devOptions.scanBatchDesc') }}</div>
        </div>
        <el-input-number
          v-model="cacheScanBatch"
          :min="10"
          :max="1000"
          :step="10"
          :disabled="disabled"
          size="default"
          @change="onCacheScanBatchChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbBatch') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbBatchDesc') }}</div>
        </div>
        <el-input-number
          v-model="cacheThumbBatch"
          :min="10"
          :max="500"
          :step="10"
          :disabled="disabled"
          size="default"
          @change="onCacheThumbBatchChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbWorkers') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbWorkersDesc') }}</div>
        </div>
        <el-input-number
          v-model="thumbWorkers"
          :min="THUMB_WORKERS_DEFAULT"
          :max="THUMB_WORKERS_MAX"
          :step="1"
          :disabled="disabled"
          size="default"
          @change="onThumbWorkersChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbTimeout') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbTimeoutDesc') }}</div>
        </div>
        <el-input-number
          v-model="thumbTimeout"
          :min="THUMB_TIMEOUT_MIN"
          :max="THUMB_TIMEOUT_MAX"
          :step="10000"
          :disabled="disabled"
          size="default"
          @change="onThumbTimeoutChange"
        />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('devOptions.thumbSlow') }}</div>
          <div class="dev-desc">{{ t('devOptions.thumbSlowDesc') }}</div>
        </div>
        <el-input-number
          v-model="thumbSlowMs"
          :min="THUMB_SLOW_MIN"
          :max="THUMB_SLOW_MAX"
          :step="500"
          :disabled="disabled"
          size="default"
          @change="onThumbSlowChange"
        />
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('roots.maintainTools') }}</span>
          <el-tag v-if="maintainBusy" size="small" type="primary" effect="plain">{{
            t('roots.taskRunning')
          }}</el-tag>
        </div>
      </template>
      <div class="dev-desc-block">{{ t('roots.maintainDesc') }}</div>
      <div class="maintain-row">
        <el-select
          v-model="maintainRootId"
          class="maintain-select"
          :placeholder="t('roots.selectMaintainRoot')"
          clearable
          :disabled="maintainBusy"
        >
          <el-option
            v-for="root in roots"
            :key="root.id"
            :value="root.id"
            :label="displayName(root)"
          >
            <el-tooltip :content="root.path" placement="left" :show-after="300">
              <span>{{ displayName(root) }}</span>
            </el-tooltip>
          </el-option>
        </el-select>

        <template v-for="item in MAINTAIN_MODES" :key="item.mode">
          <el-tooltip
            :disabled="maintainRootId != null"
            :content="t('roots.selectRootFirst')"
            placement="top"
          >
            <span>
              <el-button
                :type="buttonType(item.mode)"
                plain
                :disabled="maintainRootId == null || maintainBusy"
                :loading="maintainBusy"
                @click="maintain(item.mode)"
              >
                {{ item.label }}
              </el-button>
            </span>
          </el-tooltip>
        </template>
      </div>
    </el-card>

    <el-card class="dev-card" shadow="never">
      <template #header>{{ t('performance.scrollTitle') }}</template>
      <div class="dev-desc-block">{{ t('performance.pageDesc') }}</div>

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('performance.bufferLazy') }}</div>
          <div class="dev-desc">{{ t('performance.bufferLazyDesc') }}</div>
        </div>
        <el-switch v-model="gridBufferLazy" :disabled="disabled" @change="onGridBufferLazyChange" />
      </div>

      <el-divider />

      <div class="dev-row cache-row">
        <div class="dev-label">
          <div class="dev-name">{{ t('performance.preload') }}</div>
          <div class="dev-desc">{{ t('performance.preloadDesc') }}</div>
        </div>
        <el-input-number
          v-model="gridPreload"
          :min="0"
          :max="GRID_PRELOAD_MAX"
          :step="100"
          :disabled="disabled"
          size="default"
          @change="onGridPreloadChange"
        />
      </div>
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

.dev-card {
  max-width: 720px;
  margin-bottom: 24px;
}

.master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.master-name {
  font-size: 14px;
  font-weight: 600;
}

.master-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dev-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

/* 长文案下数字框/开关不被挤压 */
.dev-row :deep(.el-input-number),
.dev-row :deep(.el-switch) {
  flex: 0 0 auto;
}
.dev-row :deep(.el-input-number) {
  width: 150px;
  min-width: 150px;
}

.cache-row {
  margin: 4px 0;
}

.dev-desc-block {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.dev-label {
  min-width: 0;
}

.dev-name {
  font-size: 14px;
  font-weight: 600;
}

.dev-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.cli-exe-input {
  width: 300px;
  flex-shrink: 0;
}

/* 缓存维护工具 */
.maintain-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.maintain-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.maintain-select {
  width: 260px;
  flex-shrink: 0;
}
</style>
