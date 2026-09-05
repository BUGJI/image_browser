<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { t } = useI18n()

// 目录树顶层显示全部根目录（隐藏底部下拉框）
const showAllRoots = ref(false)
// 左侧目录树顶部显示「我的收藏」入口
const showFavorites = ref(false)

let offSettingsChanged = null

onMounted(async () => {
  showAllRoots.value = (await window.api.getSetting('sidebarShowAllRoots', 'false')) === 'true'
  showFavorites.value = (await window.api.getSetting('showFavorites', 'false')) === 'true'
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'sidebarShowAllRoots') showAllRoots.value = value === 'true'
    else if (key === 'showFavorites') showFavorites.value = value === 'true'
  })
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
})

async function save(key, value) {
  try {
    await window.api.setSetting(key, value ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.sidebar') }}</h2>
    <p class="page-desc">{{ t('sidebar.pageDesc') }}</p>

    <el-card class="side-card" shadow="never">
      <div class="side-row">
        <div class="side-label">
          <div class="side-name">{{ t('appearance.sidebarShowAllRoots') }}</div>
          <div class="side-desc">{{ t('appearance.sidebarShowAllRootsDesc') }}</div>
        </div>
        <el-switch v-model="showAllRoots" @change="(v) => save('sidebarShowAllRoots', v)" />
      </div>

      <el-divider />

      <div class="side-row">
        <div class="side-label">
          <div class="side-name">{{ t('roots.showFavorites') }}</div>
          <div class="side-desc">{{ t('roots.showFavoritesDesc') }}</div>
        </div>
        <el-switch v-model="showFavorites" @change="(v) => save('showFavorites', v)" />
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

.side-card {
  max-width: 720px;
}

.side-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.side-name {
  font-size: 14px;
  font-weight: 600;
}

.side-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  max-width: 520px;
}
</style>
