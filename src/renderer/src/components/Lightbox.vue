<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Close, ArrowLeft, ArrowRight, CopyDocument } from '@element-plus/icons-vue'
import { buildImageUrl } from '../utils/image-url'

const { t } = useI18n()

/**
 * 灯箱：查看原图 + 键盘导航（←/→/Esc）+ Ctrl+C 复制当前图片
 * 复制实现：img → canvas → PNG blob → navigator.clipboard；失败回退主进程剪贴板
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
const copied = ref(false)

const current = computed(() => props.items[cur.value] || null)

function resetState() {
  loading.value = true
  loadError.value = ''
  copied.value = false
}

watch(
  () => props.index,
  (v) => {
    cur.value = v
    resetState()
  }
)

watch(cur, (v) => {
  emit('change', v)
  resetState()
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
  if (e.key === 'Escape') {
    close()
  } else if (e.key === 'ArrowLeft') {
    prev()
  } else if (e.key === 'ArrowRight') {
    next()
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    copyCurrent()
  }
}

async function copyCurrent() {
  if (!imgRef.value) return
  const img = imgRef.value
  if (!img.naturalWidth) return
  try {
    // 优先走主进程直接读文件写剪贴板（自定义协议下 canvas 会污染，不可靠）
    if (window.api?.copyImagePath) {
      await window.api.copyImagePath(current.value.absPath)
    } else {
      // 回退：canvas → dataURL → 主进程剪贴板
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')
      await window.api?.copyImageDataUrl(dataUrl)
    }
    copied.value = true
    ElMessage.success(t('lightbox.copied'))
    setTimeout(() => (copied.value = false), 1500)
  } catch (err) {
    ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
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
          <el-tooltip :content="t('lightbox.copyTip')" placement="bottom">
            <button class="lb-btn" :class="{ 'lb-btn-copied': copied }" @click="copyCurrent">
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

      <div class="lightbox-stage" @click.self="close">
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
          :src="buildImageUrl(rootId, current.absPath, 'orig')"
          :alt="current.name"
          @load="onImgLoad"
          @error="onImgError"
        />
      </div>

      <div class="lightbox-hint">{{ t('lightbox.hint') }}</div>
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
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  white-space: nowrap;
  z-index: 2;
}
</style>
