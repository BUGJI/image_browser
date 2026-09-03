<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Close, ArrowLeft, ArrowRight, CopyDocument, Files } from '@element-plus/icons-vue'
import { buildImageUrl } from '../utils/image-url'
import { loadShortcuts, eventMatches } from '../utils/shortcuts'

const { t } = useI18n()

/**
 * 灯箱：查看原图 + 键盘导航（←/→/Esc）
 * 复制：快捷键可自定义（默认 Ctrl+C 复制原文件 / Ctrl+Shift+C 复制图片）。
 * 复制图片实现：img → canvas → PNG blob → navigator.clipboard；失败回退主进程剪贴板
 */
const props = defineProps({
  rootId: { type: Number, required: true },
  items: { type: Array, default: () => [] },
  index: { type: Number, required: true }
})

const emit = defineEmits(['close', 'change'])

const cur = ref(props.index)
const imgRef = ref(null)
const loading = ref(true)
const loadError = ref('')
const copied = ref('') // '' | 'file' | 'image'

// 快捷键配置（设置 - 快捷键 中可自定义）
const shortcuts = ref({ copyFile: 'Ctrl+C', copyImage: 'Ctrl+Shift+C' })
// 灯箱滚轮行为：zoom = 缩放图片；navigate = 切换图片（设置 - 快捷键）
const wheelAction = ref('zoom')

// 图片缩放/平移视图（以中心为缩放锚点）；限制来自「设置 - 开发者选项」
const zoomCfg = ref({ min: 1, max: 8, step: 1.2 })
const view = ref({ scale: 1, tx: 0, ty: 0 })
const imgStyle = computed(() => {
  const { scale, tx, ty } = view.value
  return { transform: `translate(${tx}px, ${ty}px) scale(${scale})` }
})
function resetView() {
  view.value = { scale: zoomCfg.value.min, tx: 0, ty: 0 }
}
function zoomAtCenter(factor) {
  const { min, max } = zoomCfg.value
  const s = Math.min(max, Math.max(min, view.value.scale * factor))
  const ratio = s / view.value.scale
  view.value = { scale: s, tx: view.value.tx * ratio, ty: view.value.ty * ratio }
}
function zoomIn() {
  zoomAtCenter(zoomCfg.value.step)
}
function zoomOut() {
  zoomAtCenter(1 / zoomCfg.value.step)
}

// 平移（仅 scale > 1 时）
let panStart = null
function onImgMouseDown(e) {
  if (view.value.scale <= 1 || e.button !== 0) return
  panStart = { sx: e.clientX, sy: e.clientY, tx: view.value.tx, ty: view.value.ty }
  e.preventDefault()
}
function onWinMouseMove(e) {
  if (!panStart) return
  view.value = {
    scale: view.value.scale,
    tx: panStart.tx + (e.clientX - panStart.sx),
    ty: panStart.ty + (e.clientY - panStart.sy)
  }
}
function onWinMouseUp() {
  panStart = null
}

// 滚轮：navigate 模式节流连跳；zoom 模式缩放
let navCooldownAt = 0
function onWheel(e) {
  e.preventDefault()
  if (wheelAction.value === 'navigate') {
    const now = Date.now()
    if (now - navCooldownAt < 150) return
    navCooldownAt = now
    if (e.deltaY > 0) next()
    else prev()
    return
  }
  if (e.deltaY > 0) zoomOut()
  else zoomIn()
}

const current = computed(() => props.items[cur.value] || null)

function resetState() {
  loading.value = true
  loadError.value = ''
  copied.value = ''
}

function resetForImage() {
  resetView()
  resetState()
}

watch(
  () => props.index,
  (v) => {
    cur.value = v
    resetForImage()
  }
)

watch(cur, (v) => {
  emit('change', v)
  resetForImage()
})

function prev() {
  if (cur.value > 0) cur.value--
}
function next() {
  if (cur.value < props.items.length - 1) cur.value++
}
function close() {
  emit('close')
}

function onImgLoad() {
  loading.value = false
  loadError.value = ''
}

function onImgError() {
  loading.value = false
  loadError.value = t('lightbox.origLoadFailed')
}

function onKeydown(e) {
  if (eventMatches(e, shortcuts.value.copyFile)) {
    e.preventDefault()
    copyFile()
    return
  }
  if (eventMatches(e, shortcuts.value.copyImage)) {
    e.preventDefault()
    copyImage()
    return
  }
  if (e.key === 'Escape') {
    close()
  } else if (e.key === 'ArrowLeft') {
    prev()
  } else if (e.key === 'ArrowRight') {
    next()
  }
}

async function flashCopied(type) {
  copied.value = type
  ElMessage.success(type === 'file' ? t('lightbox.copiedFile') : t('lightbox.copied'))
  setTimeout(() => (copied.value = ''), 1500)
}

// 复制原文件：以「文件」形式放入剪贴板（可在文件管理器直接粘贴）
async function copyFile() {
  if (!current.value?.absPath) return
  try {
    if (window.api?.copyFile) {
      await window.api.copyFile(current.value.absPath)
    } else {
      // 浏览器调试回退：复制为图片
      return copyImage()
    }
    flashCopied('file')
  } catch (err) {
    ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
  }
}

// 复制图片：解码为图像放入剪贴板（可粘贴到聊天/编辑器）
async function copyImage() {
  if (!imgRef.value || !imgRef.value.naturalWidth) return
  try {
    // 优先走主进程直接读文件写剪贴板（自定义协议下 canvas 会污染，不可靠）
    if (window.api?.copyImagePath) {
      await window.api.copyImagePath(current.value.absPath)
    } else {
      // 回退：canvas → dataURL → 主进程剪贴板
      const img = imgRef.value
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')
      await window.api?.copyImageDataUrl(dataUrl)
    }
    flashCopied('image')
  } catch (err) {
    ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
  }
}

// 工具栏「复制图片」按钮
function onCopyImageClick() {
  copyImage()
}

onMounted(async () => {
  shortcuts.value = await loadShortcuts()
  const wa = await window.api?.getSetting('lightboxWheelAction', 'zoom')
  wheelAction.value = ['zoom', 'navigate'].includes(wa) ? wa : 'zoom'
  // 读取开发者选项里的灯箱缩放限制
  const parseNum = async (key, fb) => {
    const n = parseFloat((await window.api?.getSetting(key, String(fb))) || '')
    return Number.isFinite(n) && n > 0 ? n : fb
  }
  const min = await parseNum('lightboxZoomMin', 0.5)
  const max = Math.max(await parseNum('lightboxZoomMax', 8), min)
  const step = await parseNum('lightboxZoomStep', 1.2)
  zoomCfg.value = { min, max, step }
  view.value = { scale: Math.min(Math.max(1, min), max), tx: 0, ty: 0 }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onWinMouseMove)
  window.addEventListener('mouseup', onWinMouseUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onWinMouseMove)
  window.removeEventListener('mouseup', onWinMouseUp)
})
</script>

<template>
  <Teleport to="body">
    <div class="lightbox-mask" @click.self="close">
      <div class="lightbox-toolbar">
        <span class="lightbox-count">
          {{ cur + 1 }} / {{ items.length }}
          <span class="lightbox-name">{{ current?.name || '' }}</span>
        </span>
        <div class="lightbox-toolbar-right">
          <el-tooltip
            :content="t('lightbox.copyFileTip', { key: shortcuts.copyFile })"
            placement="bottom"
          >
            <button class="lb-btn" :class="{ 'lb-btn-copied': copied === 'file' }" @click="copyFile">
              <el-icon :size="16"><Files /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip
            :content="t('lightbox.copyImageTip', { key: shortcuts.copyImage })"
            placement="bottom"
          >
            <button class="lb-btn" :class="{ 'lb-btn-copied': copied === 'image' }" @click="onCopyImageClick">
              <el-icon :size="16"><CopyDocument /></el-icon>
            </button>
          </el-tooltip>
          <button class="lb-btn" @click="close">
            <el-icon :size="16"><Close /></el-icon>
          </button>
        </div>
      </div>

      <button v-if="cur > 0" class="lb-nav lb-nav-left" @click="prev">
        <el-icon :size="26"><ArrowLeft /></el-icon>
      </button>
      <button v-if="cur < items.length - 1" class="lb-nav lb-nav-right" @click="next">
        <el-icon :size="26"><ArrowRight /></el-icon>
      </button>

      <div class="lightbox-stage" @click.self="close" @wheel.prevent="onWheel">
        <div v-show="loading" class="lightbox-loading">
          <el-icon class="is-loading" :size="30"><VideoPlay /></el-icon>
          <span>{{ t('lightbox.loadingOrig') }}</span>
        </div>
        <div v-if="loadError" class="lightbox-error">
          <el-icon :size="30"><CircleCloseFilled /></el-icon>
          <span>{{ loadError }}</span>
        </div>
        <img
          v-if="current"
          ref="imgRef"
          class="lightbox-img"
          :class="{ 'is-pannable': view.scale > 1 }"
          :src="buildImageUrl(rootId, current.absPath, 'orig')"
          :alt="current.name"
          :style="imgStyle"
          draggable="false"
          @load="onImgLoad"
          @error="onImgError"
          @mousedown="onImgMouseDown"
          @dblclick="resetView"
        />
        <span v-if="view.scale > 1" class="lightbox-zoom-badge">
          {{ Math.round(view.scale * 100) }}%
        </span>
      </div>

      <div class="lightbox-hint">
        <template v-if="shortcuts.copyFile">
          <kbd class="hint-key">{{ shortcuts.copyFile }}</kbd
          >{{ t('lightbox.copyFileAction') }}<i class="hint-sep">·</i>
        </template>
        <template v-if="shortcuts.copyImage">
          <kbd class="hint-key">{{ shortcuts.copyImage }}</kbd
          >{{ t('lightbox.copyImageAction') }}<i class="hint-sep">·</i>
        </template>
        <span>{{ t('lightbox.navHint') }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox-mask {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.lightbox-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  color: #fff;
  z-index: 2;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent);
}

.lightbox-count {
  font-size: 13px;
  color: #e5e6eb;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lightbox-name {
  color: #9aa0a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}

.lightbox-toolbar-right {
  display: flex;
  gap: 8px;
}

.lb-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.lb-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.lb-btn-copied {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.22);
}

.lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 46px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.lb-nav:hover {
  background: rgba(255, 255, 255, 0.28);
}

.lb-nav-left {
  left: 18px;
}

.lb-nav-right {
  right: 18px;
}

.lightbox-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 60px 72px 48px;
  box-sizing: border-box;
}

.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}

.lightbox-img.is-pannable {
  cursor: grab;
}

.lightbox-img.is-pannable:active {
  cursor: grabbing;
}

.lightbox-zoom-badge {
  position: absolute;
  top: 64px;
  right: 28px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.lightbox-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #b9bec4;
  font-size: 13px;
}

.lightbox-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #f56c6c;
  font-size: 13px;
}

.lightbox-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  white-space: nowrap;
  z-index: 2;
}

.hint-key {
  font-family: inherit;
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #e5e6eb;
}

.hint-sep {
  font-style: normal;
  color: rgba(255, 255, 255, 0.3);
}
</style>
