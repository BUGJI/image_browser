import {
  InfoFilled,
  SuccessFilled,
  WarningFilled,
  CircleCloseFilled,
  VideoPlay
} from '@element-plus/icons-vue'

// 通知类型 → 图标 / 颜色（主窗口通知面板与弹出区共用）
export const NOTIFY_TYPE_ICON = {
  info: InfoFilled,
  success: SuccessFilled,
  warning: WarningFilled,
  error: CircleCloseFilled,
  progress: VideoPlay
}

export const NOTIFY_TYPE_COLOR = {
  info: '#409eff',
  success: '#67c23a',
  warning: '#e6a23c',
  error: '#f56c6c',
  progress: '#409eff'
}
