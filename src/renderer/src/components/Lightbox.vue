<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Close, ArrowLeft, ArrowRight, CopyDocument, Files, Star, StarFilled, CollectionTag } from '@element-plus/icons-vue'
import { buildImageUrl, isVideoName } from '../utils/image-url'
import { loadShortcuts, eventMatches } from '../utils/shortcuts'
import { useFavoritesStore } from '../stores/favorites'
import { useTagsStore } from '../stores/tags'

const { t } = useI18n()
const favoritesStore = useFavoritesStore()
const tagsStore = useTagsStore()

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
const videoRef = ref(null)
const loading = ref(true)
const loadError = ref('')
const copied = ref('') // '' | 'file' | 'image'

// 快捷键配置（设置 - 快捷键 中可自定义）
const shortcuts = ref({ copyFile: 'Ctrl+C', copyImage: 'Ctrl+Shift+C' })
// 灯箱滚轮行为：zoom = 缩放图片；navigate = 切换图片（设置 - 快捷键）
const wheelAction = ref('zoom')

// 扩展功能开关：收藏夹 / 标签（功能总开关 × 灯箱按钮显示开关）
const favoritesEnabled = ref(true)
const favLightboxBtn = ref(true)
const tagsEnabled = ref(true)
const tagsLightboxBtn = ref(true)
// WebM 是否按动图（GIF 同类）处理：循环静音自动播放
const webmAsGif = ref(false)

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

// 滚轮：navigate 模式节流连跳；zoom 模式缩放（视频交给原生控件，不拦截）
let navCooldownAt = 0
function onWheel(e) {
  if (isVideo.value) return
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
const isVideo = computed(() => isVideoName(current.value?.name))

function resetState() {
  loading.value = true
  loadError.value = ''
  copied.value = ''
}

function resetForImage() {
  resetView()
  resetState()
  const v = videoRef.value
  if (v) {
    try {
      v.pause()
      v.currentTime = 0
    } catch {
      /* ignore */
    }
  }
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

// 视频首帧就绪：结束 loading 并显式播放（动态切换 src 时 autoplay 属性不一定会触发）
function onVideoReady() {
  loading.value = false
  loadError.value = ''
  videoRef.value?.play?.().catch(() => {})
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

// 复制图片：解码为图像放入剪贴板（可粘贴到聊天/编辑器）；视频复制当前帧
async function copyImage() {
  const item = current.value
  if (!item) return
  try {
    if (isVideoName(item.name)) {
      const v = videoRef.value
      if (!v || !v.videoWidth) return
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      canvas.getContext('2d').drawImage(v, 0, 0)
      await window.api?.copyImageDataUrl(canvas.toDataURL('image/png'))
      flashCopied('image')
      return
    }
    if (!imgRef.value || !imgRef.value.naturalWidth) return
    // 优先走主进程直接读文件写剪贴板（自定义协议下 canvas 会污染，不可靠）
    if (window.api?.copyImagePath) {
      await window.api.copyImagePath(item.absPath)
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

// 收藏 / 取消收藏当前图片
async function toggleFavCurrent() {
  const item = current.value
  if (!item?.absPath) return
  try {
    const added = await favoritesStore.toggle(
      { id: props.rootId },
      { absPath: item.absPath, name: item.name }
    )
    ElMessage.success(added ? t('lightbox.favAdded') : t('lightbox.favRemoved'))
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.operationFailed')))
  }
}

// ---------- 标签：给当前图片打/改标签（多选 + 可新建） ----------
const tagPopOpen = ref(false)
const tagBusy = ref(false)
const selTagNames = ref([])
const tagOptions = computed(() => tagsStore.tags)

async function ensureTagsLoaded() {
  if (tagsStore.rootId === props.rootId && tagsStore.loaded) return
  await tagsStore.load({ id: props.rootId })
}

// 打开编辑面板时，读取该图片当前已打的标签
async function onTagPopShow() {
  const item = current.value
  if (!item?.absPath || !window.api?.tagsGet) {
    selTagNames.value = []
    return
  }
  tagBusy.value = true
  try {
    await ensureTagsLoaded()
    const list = (await window.api.tagsGet(props.rootId, item.absPath)) || []
    selTagNames.value = list.map((x) => x.name)
  } catch {
    selTagNames.value = []
  } finally {
    tagBusy.value = false
  }
}

// 多选结果变化即保存（整体覆盖；含新建标签）
async function onTagNamesChange(names) {
  const item = current.value
  if (!item?.absPath || !window.api?.tagsSet) return
  if (tagBusy.value) return
  try {
    await tagsStore.setImageTags(
      { id: props.rootId },
      { absPath: item.absPath, name: item.name || '' },
      names || []
    )
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.operationFailed')))
  }
}

onMounted(async () => {
  shortcuts.value = await loadShortcuts()
  const wa = await window.api?.getSetting('lightboxWheelAction', 'zoom')
  wheelAction.value = ['zoom', 'navigate'].includes(wa) ? wa : 'zoom'
  favoritesEnabled.value = (await window.api?.getSetting('favoritesEnabled', 'true')) !== 'false'
  favLightboxBtn.value = (await window.api?.getSetting('favoritesLightboxBtn', 'true')) !== 'false'
  tagsEnabled.value = (await window.api?.getSetting('tagsEnabled', 'true')) !== 'false'
  tagsLightboxBtn.value = (await window.api?.getSetting('tagsLightboxBtn', 'true')) !== 'false'
  webmAsGif.value = (await window.api?.getSetting('webmAsGif', 'false')) === 'true'
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
          <el-popover
            v-if="tagsEnabled && tagsLightboxBtn"
            v-model:visible="tagPopOpen"
            placement="bottom-end"
            :width="280"
            trigger="click"
            popper-class="lightbox-tag-popper"
            @show="onTagPopShow"
          >
            <template #reference>
              <button
                class="lb-btn"
                :class="{ 'lb-btn-tag-active': selTagNames.length }"
                :title="t('lightbox.tagImage')"
              >
                <el-icon :size="16"><CollectionTag /></el-icon>
              </button>
            </template>
            <div class="lightbox-tag-editor">
              <div class="lightbox-tag-title">{{ t('lightbox.tagImage') }}</div>
              <el-select
                v-model="selTagNames"
                multiple
                filterable
                allow-create
                :reserve-keyword="false"
                :default-first-option="false"
                collapse-tags
                :max-collapse-tags="2"
                :placeholder="t('lightbox.tagSelectPlaceholder')"
                :disabled="tagBusy"
                class="lightbox-tag-select"
                @change="onTagNamesChange"
              >
                <el-option
                  v-for="opt in tagOptions"
                  :key="opt.id"
                  :label="opt.name"
                  :value="opt.name"
                />
              </el-select>
              <p class="lightbox-tag-tip">{{ t('lightbox.tagSelectTip') }}</p>
            </div>
          </el-popover>

          <el-tooltip
            v-if="favoritesEnabled && favLightboxBtn"
            :content="
              favoritesStore.isFav(current?.absPath)
                ? t('lightbox.favRemove')
                : t('lightbox.favAdd')
            "
            placement="bottom"
          >
            <button
              class="lb-btn lb-btn-fav"
              :class="{ 'is-fav': favoritesStore.isFav(current?.absPath) }"
              @click="toggleFavCurrent"
            >
              <el-icon :size="16">
                <Star v-if="!favoritesStore.isFav(current?.absPath)" />
                <StarFilled v-else />
              </el-icon>
            </button>
          </el-tooltip>
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

      <div class="lightbox-stage" @click.self="close" @wheel="onWheel">
        <div v-show="loading" class="lightbox-loading">
          <el-icon class="is-loading" :size="30"><VideoPlay /></el-icon>
          <span>{{ t('lightbox.loadingOrig') }}</span>
        </div>
        <div v-if="loadError" class="lightbox-error">
          <el-icon :size="30"><CircleCloseFilled /></el-icon>
          <span>{{ loadError }}</span>
        </div>
        <video
          v-if="current && isVideo"
          ref="videoRef"
          class="lightbox-video"
          :src="buildImageUrl(rootId, current.absPath, 'orig')"
          :controls="!webmAsGif"
          :loop="webmAsGif"
          :muted="webmAsGif"
          autoplay
          crossorigin="anonymous"
          @loadeddata="onVideoReady"
          @error="onImgError"
        />
        <img
          v-else-if="current"
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
        <span v-if="!isVideo && view.scale > 1" class="lightbox-zoom-badge">
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
  /* 自绘顶栏窗口顶部是 -webkit-app-region: drag 的拖拽区（原生 caption），
     会抢走灯箱顶栏按钮的点击/右键。整屏覆盖层声明 no-drag 即可把这部分
     从拖拽区中挖出来，灯箱内全部可正常交互。 */
  -webkit-app-region: no-drag;
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

.lb-btn-fav.is-fav {
  color: #ffd04b;
  background: rgba(255, 208, 75, 0.18);
}

.lb-btn-tag-active {
  color: #409eff;
  background: rgba(64, 158, 255, 0.18);
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

.lightbox-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  background: #000;
  outline: none;
  z-index: 1;
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

<style>
/* 灯箱标签编辑面板（el-popover 挂 body 下，需全局样式） */
.lightbox-tag-popper {
  padding: 6px;
}

.lightbox-tag-editor {
  min-height: 90px;
}

.lightbox-tag-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.lightbox-tag-select {
  width: 100%;
}

.lightbox-tag-tip {
  margin: 8px 0 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
