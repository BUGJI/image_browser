/** 字节数格式化：自动选择 B/KB/MB/GB（保留 1 位小数，数值较大或 B 级取整） */
export function formatBytes(n) {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** 数字千分位 */
export function formatCount(n) {
  return Number(n || 0).toLocaleString()
}

/** ISO 时间 → 本地日期时间；无效值返回回退文案 */
export function formatDateTime(iso, fallback = '') {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleString()
}
