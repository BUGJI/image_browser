<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnimationsStore } from '../../stores/animations'
import { useGifStore } from '../../stores/gif'

const { t } = useI18n()
const animations = useAnimationsStore()
const gifStore = useGifStore()

function onChange(key, v) {
  animations.setFlag(key, v)
}

// ---------- 动图（GIF / WebM）设置 ----------
// 首帧来源：realtime（实时解帧，不落盘） ↔ disk（磁盘缓存首帧）
const realtimeSource = computed({
  get: () => gifStore.thumbSource === 'realtime',
  set: (v) => setThumbSource(v ? 'realtime' : 'disk')
})

async function onPlayModeChange(v) {
  try {
    await gifStore.setPlayMode(v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function setThumbSource(v) {
  try {
    await gifStore.setThumbSource(v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onWebmAsGifChange(v) {
  try {
    await gifStore.setWebmAsGif(v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

onMounted(() => {
  gifStore.load()
})
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.animations') }}</h2>
    <p class="page-desc">{{ t('animations.pageDesc') }}</p>

    <el-card class="anim-card" shadow="never">
      <div class="anim-row">
        <div class="anim-label">
          <div class="anim-name">{{ t('animations.theme') }}</div>
          <div class="anim-desc">{{ t('animations.themeDesc') }}</div>
        </div>
        <el-switch :model-value="animations.animTheme" @change="(v) => onChange('animTheme', v)" />
      </div>

      <el-divider class="row-divider" />

      <div class="anim-row">
        <div class="anim-label">
          <div class="anim-name">{{ t('animations.notify') }}</div>
          <div class="anim-desc">{{ t('animations.notifyDesc') }}</div>
        </div>
        <el-switch
          :model-value="animations.animNotify"
          @change="(v) => onChange('animNotify', v)"
        />
      </div>

      <el-divider class="row-divider" />

      <div class="anim-row">
        <div class="anim-label">
          <div class="anim-name">{{ t('animations.element') }}</div>
          <div class="anim-desc">{{ t('animations.elementDesc') }}</div>
        </div>
        <el-switch
          :model-value="animations.animElement"
          @change="(v) => onChange('animElement', v)"
        />
      </div>
    </el-card>

    <!-- 动图（GIF / WebM）设置 -->
    <el-card class="anim-card gif-card" shadow="never">
      <template #header>
        <div class="gif-head">
          <span>{{ t('roots.gifSectionTitle') }}</span>
        </div>
      </template>
      <p class="page-desc gif-card-desc">{{ t('roots.gifSectionDesc') }}</p>

      <div class="gif-block">
        <div class="gif-label">{{ t('roots.gifPlayMode') }}</div>
        <el-radio-group
          v-model="gifStore.playMode"
          class="gif-radio-group"
          @change="onPlayModeChange"
        >
          <div class="gif-radio-row">
            <el-radio value="all">{{ t('roots.gifAll') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifAllDesc') }}</span>
          </div>
          <div class="gif-radio-row">
            <el-radio value="hover">{{ t('roots.gifHover') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifHoverDesc') }}</span>
          </div>
          <div class="gif-radio-row">
            <el-radio value="none">{{ t('roots.gifNone') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifNoneDesc') }}</span>
          </div>
        </el-radio-group>
      </div>

      <el-divider />

      <div class="gif-block">
        <div class="gif-label">
          <span>{{ t('roots.gifThumbSource') }}</span>
          <el-switch
            v-model="realtimeSource"
            class="gif-source-switch"
            :active-text="t('roots.gifSourceRealtime')"
            :inactive-text="t('roots.gifSourceDisk')"
          />
        </div>
        <p class="gif-source-desc">{{ t('roots.gifSourceDesc') }}</p>
      </div>

      <el-divider />

      <div class="gif-block">
        <div class="gif-label">
          <span>{{ t('roots.webmAsGif') }}</span>
          <el-switch
            v-model="gifStore.webmAsGif"
            class="gif-source-switch"
            @change="onWebmAsGifChange"
          />
        </div>
        <p class="gif-source-desc">{{ t('roots.webmAsGifDesc') }}</p>
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

.anim-card {
  max-width: 720px;
}

.anim-card + .anim-card {
  margin-top: 20px;
}

.anim-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.anim-name {
  font-size: 14px;
  font-weight: 600;
}

.anim-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.row-divider {
  margin: 14px 0;
}

/* 动图（GIF）设置 */
.gif-card-desc {
  margin: 0 0 12px;
}

.gif-block {
  max-width: 720px;
}

.gif-label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text);
}

.gif-radio-group {
  display: block;
  margin-top: 10px;
}

.gif-radio-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.gif-radio-row .el-radio {
  white-space: nowrap;
  flex-shrink: 0;
  margin-right: 0;
}

.gif-radio-desc {
  color: #999;
  font-size: 12px;
  line-height: 20px;
  padding-top: 2px;
}

.gif-source-switch {
  margin-left: auto;
}

.gif-source-desc {
  margin: 8px 0 0;
  color: #999;
  font-size: 12px;
}
</style>
