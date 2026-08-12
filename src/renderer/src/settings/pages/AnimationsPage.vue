<script setup>
import { useI18n } from 'vue-i18n'
import { useAnimationsStore } from '../../stores/animations'

const { t } = useI18n()
const animations = useAnimationsStore()

function onChange(key, v) {
  animations.setFlag(key, v)
}
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
        <el-switch :model-value="animations.animNotify" @change="(v) => onChange('animNotify', v)" />
      </div>

      <el-divider class="row-divider" />

      <div class="anim-row">
        <div class="anim-label">
          <div class="anim-name">{{ t('animations.element') }}</div>
          <div class="anim-desc">{{ t('animations.elementDesc') }}</div>
        </div>
        <el-switch :model-value="animations.animElement" @change="(v) => onChange('animElement', v)" />
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
  max-width: 560px;
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
</style>
