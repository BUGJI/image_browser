<script setup>
import { useI18n } from 'vue-i18n'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()

// 通用三档模式：none / hover / always
const OPTIONS = [
  { value: 'none', label: () => t('grid.optNone') },
  { value: 'hover', label: () => t('grid.optHover') },
  { value: 'always', label: () => t('grid.optAlways') }
]

// 文件名显示方式（默认 hover）
const nameMode = useSetting('itemNameMode')
// 右上角格式角标显示方式（默认不显示）
const extMode = useSetting('itemExtMode')
// 左上角收藏按钮显示方式（默认不显示）
const favMode = useSetting('itemFavMode')
// 左下角「图内文字」角标显示方式（默认不显示）
const textMatchMode = useSetting('itemTextMatchMode')
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.cardPage') }}</h2>
    <p class="page-desc">{{ t('grid.pageDesc') }}</p>

    <SettingCard :reset-keys="['itemNameMode', 'itemExtMode', 'itemFavMode', 'itemTextMatchMode']">
      <SettingRow :name="t('grid.nameRow')" :desc="t('grid.nameRowDesc')">
        <el-radio-group v-model="nameMode">
          <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
            {{ o.label() }}
          </el-radio-button>
        </el-radio-group>
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('grid.extRow')" :desc="t('grid.extRowDesc')">
        <el-radio-group v-model="extMode">
          <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
            {{ o.label() }}
          </el-radio-button>
        </el-radio-group>
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('grid.favRow')" :desc="t('grid.favRowDesc')">
        <el-radio-group v-model="favMode">
          <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
            {{ o.label() }}
          </el-radio-button>
        </el-radio-group>
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('grid.textRow')" :desc="t('grid.textRowDesc')">
        <el-radio-group v-model="textMatchMode">
          <el-radio-button v-for="o in OPTIONS" :key="o.value" :value="o.value">
            {{ o.label() }}
          </el-radio-button>
        </el-radio-group>
      </SettingRow>
    </SettingCard>
  </div>
</template>
