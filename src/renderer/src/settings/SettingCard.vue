<script setup>
import ResetDefaultsButton from './ResetDefaultsButton.vue'

/**
 * 设置卡片：统一宽度/间距/标题头部，并内建「恢复默认值」按钮。
 * - title        头部标题
 * - desc         标题下的说明文字（可选）
 * - resetKeys    传入设置键数组时，头部右侧显示「恢复默认值」
 * - resetDisabled 禁用恢复按钮
 */
defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  resetKeys: { type: Array, default: null },
  resetDisabled: { type: Boolean, default: false }
})
</script>

<template>
  <el-card class="set-card" shadow="never">
    <template v-if="title || $slots.header" #header>
      <div class="set-card-head">
        <span class="set-card-title">{{ title }}</span>
        <div class="set-card-actions">
          <slot name="header" />
          <ResetDefaultsButton
            v-if="resetKeys && resetKeys.length"
            :keys="resetKeys"
            :disabled="resetDisabled"
          />
        </div>
      </div>
    </template>
    <div v-if="desc" class="set-card-desc">{{ desc }}</div>
    <slot />
  </el-card>
</template>

<style scoped>
.set-card {
  /* 宽度由设置页内容列（.page）统一约束 */
  margin-bottom: 24px;
}

.set-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.set-card-title {
  font-weight: 600;
}

.set-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.set-card-desc {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
</style>
