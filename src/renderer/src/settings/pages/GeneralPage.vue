<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { LOCALES } from '../../i18n'
import { useLocaleStore } from '../../stores/locale'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()
const localeStore = useLocaleStore()

const dbVersion = ref('')
const dataLocation = computed(() => t('general.dataLocation'))

// 关闭软件行为：ask = 每次询问；tray = 最小化到托盘；quit = 关闭软件
const CLOSE_OPTIONS = computed(() => [
  { value: 'ask', label: t('general.closeAsk'), desc: t('general.closeAskDesc') },
  { value: 'tray', label: t('general.closeTray'), desc: t('general.closeTrayDesc') },
  { value: 'quit', label: t('general.closeQuit'), desc: t('general.closeQuitDesc') }
])
function optionLabel(options, v) {
  return options.find((o) => o.value === v)?.label || v
}
const closeAction = useSetting('closeAction', {
  message: (v) => t('general.savedCloseAction', { action: optionLabel(CLOSE_OPTIONS.value, v) })
})

const selectedLocale = ref(localeStore.locale)

// 记忆窗口大小 / 每次启动检测更新 / 记忆缩放
const rememberWindowSize = useSetting('rememberWindowSize')
const checkUpdateOnStartup = useSetting('checkUpdateOnStartup')
const rememberZoom = useSetting('rememberZoom')

// 快速复制默认类型：file = 复制原文件；image = 复制图片
const QUICK_COPY_OPTIONS = computed(() => [
  { value: 'file', label: t('general.quickCopyFile'), desc: t('general.quickCopyFileDesc') },
  { value: 'image', label: t('general.quickCopyImage'), desc: t('general.quickCopyImageDesc') }
])
const quickCopyType = useSetting('quickCopyType', {
  message: (v) =>
    t('general.savedQuickCopyType', { type: optionLabel(QUICK_COPY_OPTIONS.value, v) })
})

// 同步外部加载/修改的语言（主进程持久化值可能在挂载后才恢复）
watch(
  () => localeStore.locale,
  (v) => {
    selectedLocale.value = v
  }
)

onMounted(async () => {
  try {
    dbVersion.value = await window.api.getDbVersion()
  } catch {
    dbVersion.value = '-'
  }
  selectedLocale.value = localeStore.locale
})

async function onLocaleChange(v) {
  try {
    await localeStore.setLocale(v)
    selectedLocale.value = v
    ElMessage.success(t('general.savedLanguage'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.general') }}</h2>
    <p class="page-desc">{{ t('general.pageDesc') }}</p>

    <SettingCard :title="t('general.closeBehavior')">
      <SettingRow :name="t('general.onClose')" :desc="t('general.onCloseDesc')">
        <el-select v-model="closeAction" class="setting-select">
          <el-option v-for="o in CLOSE_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
        </el-select>
      </SettingRow>
      <p class="row-tip">{{ CLOSE_OPTIONS.find((o) => o.value === closeAction)?.desc }}</p>
    </SettingCard>

    <SettingCard>
      <SettingRow :name="t('settings.language')" :desc="t('general.languageDesc')">
        <el-select v-model="selectedLocale" class="setting-select" @change="onLocaleChange">
          <el-option v-for="l in LOCALES" :key="l.value" :value="l.value" :label="l.label" />
        </el-select>
      </SettingRow>
    </SettingCard>

    <SettingCard :title="t('general.quickCopy')">
      <SettingRow :name="t('general.quickCopyDefault')" :desc="t('general.quickCopyDefaultDesc')">
        <el-select v-model="quickCopyType" class="setting-select">
          <el-option
            v-for="o in QUICK_COPY_OPTIONS"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
      </SettingRow>
      <p class="row-tip">
        {{ QUICK_COPY_OPTIONS.find((o) => o.value === quickCopyType)?.desc }}
      </p>
    </SettingCard>

    <SettingCard :title="t('general.startupWindow')">
      <SettingRow
        :name="t('general.rememberWindowSize')"
        :desc="t('general.rememberWindowSizeDesc')"
      >
        <el-switch v-model="rememberWindowSize" />
      </SettingRow>

      <el-divider />

      <SettingRow
        :name="t('general.checkUpdateOnStartup')"
        :desc="t('general.checkUpdateOnStartupDesc')"
      >
        <el-switch v-model="checkUpdateOnStartup" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('general.rememberZoom')" :desc="t('general.rememberZoomDesc')">
        <el-switch v-model="rememberZoom" />
      </SettingRow>
    </SettingCard>

    <el-descriptions :column="1" border class="info-table">
      <el-descriptions-item :label="t('general.appNameLabel')">Image Browser</el-descriptions-item>
      <el-descriptions-item :label="t('general.sqliteVersion')">{{
        dbVersion || t('common.loading')
      }}</el-descriptions-item>
      <el-descriptions-item :label="t('general.dataLocationLabel')">{{
        dataLocation
      }}</el-descriptions-item>
    </el-descriptions>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('general.moreTip') }}</p>
    </el-alert>
  </div>
</template>

<style scoped>
.row-tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.info-table {
  margin-bottom: 24px;
}
</style>
