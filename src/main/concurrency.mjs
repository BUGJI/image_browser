/**
 * 并发受限的批量映射：最多 limit 个 fn 同时执行。
 * 用下标游标而非 shift()，避免大数组下的 O(n²) 开销。
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : []
  const n = Math.min(Math.max(1, limit), list.length)
  let cursor = 0
  const workers = Array.from({ length: n }, async () => {
    while (cursor < list.length) {
      const i = cursor++
      await fn(list[i], i)
    }
  })
  await Promise.all(workers)
}
