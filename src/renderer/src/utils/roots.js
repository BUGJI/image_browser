/**
 * 根目录展示/维护相关的共享工具。
 * RootsPage / TagsPage / AiSearchPage / OcrSearchPage / SideBar 曾各写一份，
 * 集中于此避免规则漂移（如别名优先、按钮配色）。
 */

/** 显示名：别名 > 目录名 > 完整路径 */
export function rootDisplayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = String(root.path)
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
}

/** 维护按钮配色：update=primary / rebuild=warning / scan-cache=info / 其它=danger */
export function indexButtonType(mode) {
  if (mode === 'update') return 'primary'
  if (mode === 'rebuild') return 'warning'
  if (mode === 'scan-cache') return 'info'
  return 'danger'
}
