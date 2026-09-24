<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()

// 收藏夹功能总开关（关闭后主界面收藏入口与收藏按钮不可用，数据保留）
const favoritesEnabled = useSetting('favoritesEnabled', {
  message: (v) => (v ? t('favorites.enabled') : t('favorites.disabled')),
  messageType: (v) => (v ? 'success' : 'info')
})
const disabled = computed(() => !favoritesEnabled.value)

// 左侧目录树顶部是否显示「我的收藏」入口
const showFavoritesEntry = useSetting('showFavorites')
// 灯箱右上角是否显示收藏按钮
const favLightboxBtn = useSetting('favoritesLightboxBtn')
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.favorites') }}</h2>
    <p class="page-desc">{{ t('favorites.pageDesc') }}</p>

    <SettingCard>
      <SettingRow :name="t('favorites.enableMaster')" :desc="t('favorites.masterDesc')">
        <el-switch v-model="favoritesEnabled" />
      </SettingRow>
    </SettingCard>

    <SettingCard>
      <SettingRow :name="t('favorites.showEntry')" :desc="t('favorites.showEntryDesc')">
        <el-switch v-model="showFavoritesEntry" :disabled="disabled" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('favorites.lightboxBtn')" :desc="t('favorites.lightboxBtnDesc')">
        <el-switch v-model="favLightboxBtn" :disabled="disabled" />
      </SettingRow>
    </SettingCard>

    <el-empty v-if="disabled" :description="t('favorites.offTip')" :image-size="72" />
  </div>
</template>
