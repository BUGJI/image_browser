<script setup>
import { useI18n } from 'vue-i18n'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()

// 目录树顶层显示全部根目录（隐藏底部下拉框）
const showAllRoots = useSetting('sidebarShowAllRoots')
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.sidebar') }}</h2>
    <p class="page-desc">{{ t('sidebar.pageDesc') }}</p>

    <SettingCard>
      <SettingRow
        :name="t('appearance.sidebarShowAllRoots')"
        :desc="t('appearance.sidebarShowAllRootsDesc')"
      >
        <el-switch v-model="showAllRoots" />
      </SettingRow>
    </SettingCard>
  </div>
</template>
