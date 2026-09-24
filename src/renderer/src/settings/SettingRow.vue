<script setup>
/**
 * 设置项行：左侧「标题 + 描述」（可选附加内容），右侧控件插槽。
 * 统一各页原本各写一套的 xxx-row / xxx-name / xxx-desc 布局。
 */
defineProps({
  name: { type: String, default: '' },
  desc: { type: String, default: '' },
  // 控件与文字的对齐：center（默认）| top（右侧较高时用）
  align: { type: String, default: 'center' }
})
</script>

<template>
  <div class="set-row" :class="`set-row--${align}`">
    <div class="set-label">
      <div v-if="name" class="set-name">{{ name }}</div>
      <div v-if="desc || $slots.desc" class="set-desc">
        <slot name="desc">{{ desc }}</slot>
      </div>
      <slot name="extra" />
    </div>
    <div class="set-control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.set-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.set-row--center {
  align-items: center;
}

.set-row--top {
  align-items: flex-start;
}

.set-label {
  min-width: 0;
}

.set-name {
  font-size: 14px;
  font-weight: 600;
}

.set-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.set-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
</style>
