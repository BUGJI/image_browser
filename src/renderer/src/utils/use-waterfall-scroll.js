/**
 * 瀑布流滚动处理：把 scroll 事件节流到每帧一次，统一驱动布局/加载器/分页。
 * 从 WaterfallGrid.vue 拆出。
 *
 * @param {Object} deps
 * @param {() => HTMLElement|null} deps.getScrollEl 滚动容器
 * @param {Object} deps.layout useWaterfallLayout 返回对象（updateScrollTop）
 * @param {Object} deps.loader useImageLoader 返回对象（enterScroll/primeViewportSrcs/scheduleScrollIdle）
 * @param {() => void} deps.maybeLoadMore 分页加载检查
 */
export function useWaterfallScroll({ getScrollEl, layout, loader, maybeLoadMore }) {
  let scrollRaf = 0

  function onScroll() {
    // 立即进入滚动态：暂停缓冲区加载（滚动优先）
    loader.enterScroll()
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      layout.updateScrollTop(getScrollEl()?.scrollTop || 0)
      // 只保证严格可视区图片有 src；缓冲区等滚动空闲后由 idle 调度填充
      loader.primeViewportSrcs()
      loader.scheduleScrollIdle()
      maybeLoadMore()
    })
  }

  function cancelScroll() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf)
  }

  return { onScroll, cancelScroll }
}
