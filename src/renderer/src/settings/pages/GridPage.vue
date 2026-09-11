<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { t } = useI18n()

// 通用三档模式：none / hover / always
const MODES = ['none', 'hover', 'always']

// 文件名显示方式（默认 hover）
const nameMode = ref('hover')
// 右上角格式角标显示方式（默认不显示）
const extMode = ref('none')
// 左上角收藏按钮显示方式（默认不显示）
const favMode = ref('none')
// 左下角「图内文字」角标显示方式（默认悬停显示）
const textMatchMode = ref('hover')
const OPTIONS = [
  { value: 'none', label: () => t('grid.optNone') },
  { value: 'hover', label: () => t('grid.optHover') },
  { value: 'always', label: () => t('grid.optAlways') }
]

onMounted(async () => {
  const nm = await window.api.getSetting('itemNameMode', 'hover')
  nameMode.value = MODES.includes(nm) ? nm : 'hover'
  const em = await window.api.getSetting('itemExtMode', 'none')
  extMode.value = MODES.includes(em) ? em : 'none'
  const fm = await window.api.getSetting('itemFavMode', 'none')
  favMode.value = MODES.includes(fm) ? fm : 'none'
  const tm = await window.api.getSetting('itemTextMatchMode', 'hover')
  textMatchMode.value = MODES.includes(tm) ? tm : 'hover'
})

async function saveMode(key, v) {
  try {
    await window.api.setSetting(key, v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onNameModeChange(v) {
  saveMode('itemNameMode', v)
}

function onExtModeChange(v) {
  saveMode('itemExtMode', v)
}

function onFavModeChange(v) {
  saveMode('itemFavMode', v)
}

function onTextMatchModeChange(v) {
  saveMode('itemTextMatchMode', v)
}

</script>

<template>
  <div class="page">
    <h2>{{ t('settings.cardPage') }}</h2>
    <p class="page-desc">{{ t('grid.pageDesc') }}</p>

    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-name">{{ t('grid.nameRow') }}</div>
        <div class="setting-desc">{{ t('grid.nameRowDesc') }}</div>
      </div>
      <el-radio-group v-model="nameMode" @change="onNameModeChange">
        <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
          {{ o.label() }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-name">{{ t('grid.extRow') }}</div>
        <div class="setting-desc">{{ t('grid.extRowDesc') }}</div>
      </div>
      <el-radio-group v-model="extMode" @change="onExtModeChange">
        <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
          {{ o.label() }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-name">{{ t('grid.favRow') }}</div>
        <div class="setting-desc">{{ t('grid.favRowDesc') }}</div>
      </div>
      <el-radio-group v-model="favMode" @change="onFavModeChange">
        <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
          {{ o.label() }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-name">{{ t('grid.textRow') }}</div>
        <div class="setting-desc">{{ t('grid.textRowDesc') }}</div>
      </div>
      <el-radio-group v-model="textMatchMode" @change="onTextMatchModeChange">
        <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
          {{ o.label() }}
        </el-radio-button>
      </el-radio-group>
    </div>
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

.setting-row {
  display: flex;
  align-items: center;
  gap: 24px;
  max-width: 720px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color-overlay, transparent);
}

.setting-row + .setting-row {
  margin-top: 12px;
}

.setting-label {
  min-width: 0;
  flex: 1;
}

.setting-name {
  font-size: 14px;
  font-weight: 600;
}

.setting-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.setting-row :deep(.el-radio-group) {
  flex-shrink: 0;
}
</style>
