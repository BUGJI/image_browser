<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Picture } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../../stores/notifications'

const { t } = useI18n()
const store = useNotificationsStore()
const timers = []

onBeforeUnmount(() => {
  timers.forEach((t) => clearInterval(t))
})

// ---------- AI 流程测试：图片 → 描述 → 向量 ----------
const fileInput = ref(null)
const captioning = ref(false)
const embedding = ref(false)
const imagePreview = ref('')
const fileName = ref('')
const captionResult = ref(null)
const embedText = ref('')
const embedResult = ref(null)

function browseImage() {
  fileInput.value?.click()
}

function onFileChange() {
  const f = fileInput.value?.files?.[0]
  if (!f) return
  fileName.value = f.name
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imagePreview.value = URL.createObjectURL(f)
  captionResult.value = null
  embedResult.value = null
  embedText.value = ''
}

function base64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function runCaption() {
  const f = fileInput.value?.files?.[0]
  if (!f) {
    ElMessage.warning(t('test.aiNoImage'))
    return
  }
  captioning.value = true
  captionResult.value = null
  try {
    const buf = await f.arrayBuffer()
    const dataUrl = `data:${f.type || 'image/jpeg'};base64,${base64FromArrayBuffer(buf)}`
    captionResult.value = await window.api.aiTestCaption(dataUrl)
    // 自动把生成的描述填入步骤 3，可直接转向量
    if (captionResult.value?.caption) {
      embedText.value = captionResult.value.caption
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    captioning.value = false
  }
}

async function runEmbed() {
  const text = embedText.value.trim()
  if (!text) {
    ElMessage.warning(t('test.aiEmbedEmpty'))
    return
  }
  embedding.value = true
  embedResult.value = null
  try {
    embedResult.value = await window.api.aiTestEmbed(text)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    embedding.value = false
  }
}

function vectorPreview(vec) {
  if (!Array.isArray(vec)) return ''
  const head = vec.slice(0, 8).map((v) => v.toFixed(4)).join(', ')
  return `[${head}, …]`
}

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

// ---------- 版本号覆盖（用于测试更新检测链路） ----------
const versionOverride = ref('')
const realVersion = ref('')

onMounted(async () => {
  versionOverride.value = (await window.api.getSetting('overrideVersion', '')) || ''
  realVersion.value = (await window.api.appVersion?.()) || ''
})

async function onVersionOverrideSave() {
  const v = versionOverride.value.trim()
  if (v && !/^\d+(\.\d+){1,2}$/.test(v)) {
    ElMessage.warning(t('test.versionBadFormat'))
    return
  }
  try {
    await window.api.setSetting('overrideVersion', v)
    ElMessage.success(t('test.versionSaved', { v: v || realVersion.value }))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
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

    <!-- AI 流程测试：图片 → 描述 → 向量 -->
    <el-card class="test-card" shadow="never">
      <template #header>{{ t('test.aiFlow') }}</template>
      <p class="test-desc">{{ t('test.aiFlowDesc') }}</p>

      <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileChange" />

      <!-- 步骤 1：选择图片 -->
      <div class="ai-step">
        <div class="ai-step-head">
          <el-tag size="small" type="primary" class="ai-step-tag">1</el-tag>
          <span class="ai-step-name">{{ t('test.aiStep1') }}</span>
        </div>
        <div class="ai-step-body">
          <el-button :icon="Picture" @click="browseImage">{{ t('test.aiBrowse') }}</el-button>
          <div v-if="imagePreview" class="ai-image">
            <img :src="imagePreview" class="ai-image-preview" alt="" />
            <span class="ai-image-name">{{ fileName }}</span>
          </div>
        </div>
      </div>

      <!-- 步骤 2：图片转文字 -->
      <div class="ai-step">
        <div class="ai-step-head">
          <el-tag size="small" type="success" class="ai-step-tag">2</el-tag>
          <span class="ai-step-name">{{ t('test.aiStep2') }}</span>
        </div>
        <div class="ai-step-body">
          <el-button
            type="primary"
            :disabled="!imagePreview"
            :loading="captioning"
            @click="runCaption"
          >
            {{ t('test.aiRunCaption') }}
          </el-button>
          <template v-if="captionResult">
            <div class="ai-result">
              <div class="ai-result-label">{{ t('test.aiPromptLabel') }}（{{ captionResult.model }}）</div>
              <pre class="ai-result-box">{{ captionResult.prompt }}</pre>
            </div>
            <div class="ai-result">
              <div class="ai-result-label">{{ t('test.aiResultLabel') }}</div>
              <pre class="ai-result-box ai-result-caption">{{ captionResult.caption }}</pre>
            </div>
          </template>
        </div>
      </div>

      <!-- 步骤 3：文字转向量 -->
      <div class="ai-step">
        <div class="ai-step-head">
          <el-tag size="small" type="warning" class="ai-step-tag">3</el-tag>
          <span class="ai-step-name">{{ t('test.aiStep3') }}</span>
        </div>
        <div class="ai-step-body">
          <div class="ai-embed-row">
            <el-input
              v-model="embedText"
              :placeholder="t('test.aiEmbedPlaceholder')"
              clearable
            />
            <el-button
              type="warning"
              :disabled="!embedText.trim()"
              :loading="embedding"
              @click="runEmbed"
            >
              {{ t('test.aiRunEmbed') }}
            </el-button>
          </div>
          <template v-if="embedResult">
            <div class="ai-result">
              <div class="ai-result-label">{{ t('test.aiPromptLabel') }}（{{ embedResult.model }}）</div>
              <pre class="ai-result-box">{{ embedResult.prompt }}</pre>
            </div>
            <div class="ai-result">
              <div class="ai-result-label">{{ t('test.aiVectorInfo', { dims: embedResult.dims }) }}</div>
              <pre class="ai-result-box">{{ vectorPreview(embedResult.vector) }}</pre>
            </div>
          </template>
        </div>
      </div>
    </el-card>

    <el-card class="test-card" shadow="never">
      <template #header>{{ t('test.versionSection') }}</template>
      <p class="test-desc">{{ t('test.versionDesc') }}</p>
      <div class="version-row">
        <el-input
          v-model="versionOverride"
          :placeholder="t('test.versionPlaceholder', { v: realVersion })"
          clearable
          class="version-input"
          @keyup.enter="onVersionOverrideSave"
        />
        <el-button type="primary" @click="onVersionOverrideSave">{{ t('common.save') }}</el-button>
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

/* AI 流程测试 */
.test-desc {
  margin: 0 0 16px;
  color: #999;
  font-size: 13px;
}

.ai-step {
  padding: 14px 0;
  border-top: 1px dashed #eee;
}

.ai-step:first-of-type {
  border-top: none;
}

.ai-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ai-step-tag {
  font-weight: 600;
}

.ai-step-name {
  font-size: 14px;
  font-weight: 600;
}

.ai-step-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.ai-image {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-image-preview {
  max-width: 180px;
  max-height: 120px;
  border-radius: 6px;
  border: 1px solid #eee;
  object-fit: contain;
}

.ai-image-name {
  color: #666;
  font-size: 12px;
  word-break: break-all;
}

.ai-embed-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.ai-result {
  width: 100%;
}

.ai-result-label {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.ai-result-box {
  margin: 0;
  padding: 8px 10px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}

.ai-result-caption {
  color: var(--el-color-primary);
  font-size: 13px;
  font-weight: 500;
}

.version-row {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 420px;
}

.version-input {
  flex: 1;
}
</style>
