<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useThemeStore } from '../../stores/theme'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
// 主题启动方式：dark = 默认暗色；light = 默认亮色；last = 上次状态
const themeStartup = useSetting('themeStartup')

// 纯黑模式开关：直接联动 theme store（即时应用 + 跨窗口同步）
const pureBlack = computed({
  get: () => themeStore.pureBlack,
  set: (v) => themeStore.setPureBlack(v)
})
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.theme') }}</h2>
    <p class="page-desc">{{ t('theme.pageDesc') }}</p>

    <SettingCard :title="t('appearance.themeSetting')">
      <SettingRow
        :name="t('appearance.themeSetting')"
        :desc="t('appearance.themeSettingDesc')"
        align="top"
      >
        <el-radio-group v-model="themeStartup">
          <el-radio value="dark">{{ t('appearance.themeDefaultDark') }}</el-radio>
          <el-radio value="light">{{ t('appearance.themeDefaultLight') }}</el-radio>
          <el-radio value="last">{{ t('appearance.themeLastState') }}</el-radio>
        </el-radio-group>
      </SettingRow>
    </SettingCard>

    <SettingCard>
      <SettingRow :name="t('theme.pureBlack')" :desc="t('theme.pureBlackDesc')">
        <el-switch v-model="pureBlack" />
      </SettingRow>
    </SettingCard>
  </div>
</template>
