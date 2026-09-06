<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { t } = useI18n()

// 收藏夹功能总开关（关闭后主界面收藏入口与收藏按钮不可用，数据保留）
const favoritesEnabled = ref(true)
const disabled = computed(() => !favoritesEnabled.value)

// 左侧目录树顶部是否显示「我的收藏」入口
const showFavoritesEntry = ref(false)
// 灯箱右上角是否显示收藏按钮
const favLightboxBtn = ref(true)

let offSettingsChanged = null

onMounted(async () => {
  favoritesEnabled.value = (await window.api.getSetting('favoritesEnabled', 'true')) !== 'false'
  showFavoritesEntry.value = (await window.api.getSetting('showFavorites', 'false')) === 'true'
  favLightboxBtn.value = (await window.api.getSetting('favoritesLightboxBtn', 'true')) !== 'false'
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'favoritesEnabled') favoritesEnabled.value = value !== 'false'
    else if (key === 'showFavorites') showFavoritesEntry.value = value === 'true'
    else if (key === 'favoritesLightboxBtn') favLightboxBtn.value = value !== 'false'
  })
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
})

async function onMasterChange(v) {
  try {
    await window.api.setSetting('favoritesEnabled', v ? 'true' : 'false')
    if (v) ElMessage.success(t('favorites.enabled'))
    else ElMessage.info(t('favorites.disabled'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

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
    <h2>{{ t('settings.favorites') }}</h2>
    <p class="page-desc">{{ t('favorites.pageDesc') }}</p>

    <el-card class="fav-card" shadow="never">
      <div class="master-row">
        <div class="master-label">
          <div class="master-name">{{ t('favorites.enableMaster') }}</div>
          <div class="master-desc">{{ t('favorites.masterDesc') }}</div>
        </div>
        <el-switch v-model="favoritesEnabled" @change="onMasterChange" />
      </div>
    </el-card>

    <el-card class="fav-card" shadow="never">
      <div class="fav-row">
        <div class="fav-label">
          <div class="fav-name">{{ t('favorites.showEntry') }}</div>
          <div class="fav-desc">{{ t('favorites.showEntryDesc') }}</div>
        </div>
        <el-switch
          v-model="showFavoritesEntry"
          :disabled="disabled"
          @change="(v) => save('showFavorites', v)"
        />
      </div>

      <el-divider />

      <div class="fav-row">
        <div class="fav-label">
          <div class="fav-name">{{ t('favorites.lightboxBtn') }}</div>
          <div class="fav-desc">{{ t('favorites.lightboxBtnDesc') }}</div>
        </div>
        <el-switch
          v-model="favLightboxBtn"
          :disabled="disabled"
          @change="(v) => save('favoritesLightboxBtn', v)"
        />
      </div>
    </el-card>

    <el-empty v-if="disabled" :description="t('favorites.offTip')" :image-size="72" />
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
  margin: 0 0 24px;
}

.fav-card {
  max-width: 720px;
  margin-bottom: 16px;
}

.master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.master-name {
  font-size: 14px;
  font-weight: 600;
}

.master-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  max-width: 540px;
}

.fav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.fav-name {
  font-size: 14px;
  font-weight: 600;
}

.fav-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  max-width: 520px;
}
</style>
