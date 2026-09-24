<script setup>
import { computed } from 'vue'
import { rootDisplayName as displayName, indexButtonType as buttonType } from '../utils/roots'
import SettingCard from './SettingCard.vue'

/**
 * 维护工具卡片（缓存维护 / AI 索引 / OCR 索引共用）。
 *
 * 只负责展示：根目录选择 + 维护模式按钮，逻辑仍由各页的
 * useCacheMaintenance / useIndexMaintenance 提供并通过 v-model / @run 交互。
 *
 * - 传了 dirName / dirDesc 时使用「维护目录」两行布局（AI / OCR）；
 *   否则选择框与按钮同行（性能页）。
 * - noRootTooltip 为真且未选根目录时，按钮外层显示提示气泡。
 */
const props = defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  runningText: { type: String, default: '' },
  roots: { type: Array, default: () => [] },
  modelValue: { type: [Number, String], default: null },
  busy: { type: Boolean, default: false },
  modes: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  dirName: { type: String, default: '' },
  dirDesc: { type: String, default: '' },
  selectRootFirst: { type: String, default: '' },
  noRootTooltip: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'run'])

const dirLayout = computed(() => !!(props.dirName || props.dirDesc))
const selectDisabled = computed(() => props.disabled || props.busy)
const btnDisabled = computed(() => props.disabled || props.busy || props.modelValue == null)
</script>

<template>
  <SettingCard :title="title" :desc="desc">
    <template #header>
      <el-tag v-if="busy" size="small" type="primary" effect="plain">{{ runningText }}</el-tag>
    </template>

    <div v-if="dirLayout" class="maintain-dir-row">
      <div class="maintain-dir-label">
        <div class="maintain-dir-name">{{ dirName }}</div>
        <div class="maintain-dir-desc">{{ dirDesc }}</div>
      </div>
      <el-select
        :model-value="modelValue"
        class="maintain-select"
        :placeholder="placeholder"
        clearable
        :disabled="selectDisabled"
        @update:model-value="emit('update:modelValue', $event)"
      >
        <el-option v-for="root in roots" :key="root.id" :value="root.id" :label="displayName(root)">
          <el-tooltip :content="root.path" placement="left" :show-after="300">
            <span>{{ displayName(root) }}</span>
          </el-tooltip>
        </el-option>
      </el-select>
    </div>

    <div class="maintain-row">
      <el-select
        v-if="!dirLayout"
        :model-value="modelValue"
        class="maintain-select"
        :placeholder="placeholder"
        clearable
        :disabled="selectDisabled"
        @update:model-value="emit('update:modelValue', $event)"
      >
        <el-option v-for="root in roots" :key="root.id" :value="root.id" :label="displayName(root)">
          <el-tooltip :content="root.path" placement="left" :show-after="300">
            <span>{{ displayName(root) }}</span>
          </el-tooltip>
        </el-option>
      </el-select>

      <template v-for="item in modes" :key="item.mode">
        <el-tooltip
          v-if="noRootTooltip"
          :disabled="modelValue != null"
          :content="selectRootFirst"
          placement="top"
        >
          <span>
            <el-button
              :type="buttonType(item.mode)"
              plain
              :disabled="btnDisabled"
              :loading="busy"
              @click="emit('run', item.mode)"
            >
              {{ item.label }}
            </el-button>
          </span>
        </el-tooltip>
        <el-button
          v-else
          :type="buttonType(item.mode)"
          plain
          :disabled="btnDisabled"
          :loading="busy"
          @click="emit('run', item.mode)"
        >
          {{ item.label }}
        </el-button>
      </template>
    </div>
  </SettingCard>
</template>

<style scoped>
.maintain-row,
.maintain-dir-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.maintain-dir-row {
  margin-bottom: 14px;
}

.maintain-dir-label {
  min-width: 0;
  flex: 1;
}

.maintain-dir-name {
  font-size: 13px;
  font-weight: 600;
}

.maintain-dir-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.maintain-select {
  width: 280px;
  flex-shrink: 0;
}
</style>
