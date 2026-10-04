import { getSetting } from '../settings'
import { prep as prepCache } from '../cache-db-utils.mjs'

/**
 * 搜索与匹配工具：文件名 / 图内文字（OCR）搜索的纯逻辑与查询构造。
 * 从 cache.js 拆出，便于单测；除 ocrTextMatches 依赖 DB 与设置外，其余为纯函数。
 */

/** LIKE 转义（配合 ESCAPE '\'） */
export function likeEscape(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/**
 * OCR 图内文字命中：仅当设置里启用图内文字搜索、且该根目录已建立 ocr_text 索引时生效。
 * 返回与 files 一致的行（附加 text_hit 标记）。任何异常/缺表都静默退化为空。
 */
export function ocrTextMatches(cache, query) {
  try {
    if (getSetting('ocrEnabled', 'false') !== 'true') return []
    const q = (query || '').trim()
    if (!q) return []
    const has = prepCache(
      cache.db,
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ocr_text'"
    ).get()
    if (!has) return []
    const cnt = prepCache(cache.db, 'SELECT COUNT(*) AS c FROM ocr_text').get()
    if (!cnt || !cnt.c) return []

    // FTS5 trigram 快路径：查询 ≥3 个字符时走倒排索引，避免整表 LIKE 扫描。
    // trigram 无法命中 1~2 字符查询，故更短的查询回退 LIKE（语义完全一致）。
    const hasFts = prepCache(
      cache.db,
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ocr_fts'"
    ).get()
    if (hasFts && Array.from(q).length >= 3) {
      try {
        // 用双引号包成短语查询，转义内部引号，避免 FTS 语法字符被当作运算符
        const match = '"' + q.replace(/"/g, '""') + '"'
        return prepCache(
          cache.db,
          `SELECT f.abs_path, f.name, f.folder, f.width, f.height, f.thumb, 1 AS text_hit
             FROM ocr_fts JOIN ocr_text o ON o.rowid = ocr_fts.rowid
             JOIN files f ON f.abs_path = o.abs_path
             WHERE ocr_fts MATCH ?`
        ).all(match)
      } catch {
        /* 索引异常时回退 LIKE */
      }
    }

    const pattern = '%' + likeEscape(q) + '%'
    return prepCache(
      cache.db,
      `SELECT f.abs_path, f.name, f.folder, f.width, f.height, f.thumb, 1 AS text_hit
         FROM ocr_text o JOIN files f ON f.abs_path = o.abs_path
         WHERE o.text LIKE ? ESCAPE '\\' COLLATE NOCASE`
    ).all(pattern)
  } catch {
    return []
  }
}

/** 文件名匹配权重：完全 100 > 前缀 80 > 子串 60；通配符模式统一 60 */
export function nameMatchScore(name, query, anchored) {
  if (anchored) return 60
  const n = (name || '').toLowerCase()
  const q = (query || '').toLowerCase()
  if (!q) return 0
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 60
  return 0
}

/**
 * 合并「文件名命中」与「图内文字命中」：按 abs_path 去重，权重降序，同权重按目录/文件名。
 * match: 'name' = 文件名命中（含两者都命中）；'text' = 仅图内文字命中。
 */
export function mergeSearchResults(nameRows, textRows, query, anchored) {
  const map = new Map()
  for (const r of nameRows) {
    map.set(r.abs_path, { row: r, score: nameMatchScore(r.name, query, anchored), match: 'name' })
  }
  for (const r of textRows) {
    const cur = map.get(r.abs_path)
    if (cur) {
      // 文件名已命中，保持文件名权重与标记
      if (cur.score < 40) cur.score = 40
    } else {
      map.set(r.abs_path, { row: r, score: 40, match: 'text' })
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const f = String(a.row.folder || '').localeCompare(String(b.row.folder || ''), 'zh')
    if (f !== 0) return f
    return String(a.row.name).localeCompare(String(b.row.name), 'zh')
  })
}

/**
 * 把用户输入转为大小写不敏感的 LIKE 匹配规则。
 * - 含 * 或 ? 时按通配符整体匹配文件名（* 任意串，? 单个字符）
 * - 否则按子串匹配
 * 返回 { like, anchored }；空输入返回 null
 */
export function buildNameMatcher(query) {
  const q = (query || '').trim()
  if (!q) return null
  const anchored = /[*?]/.test(q)
  // 先转义 LIKE 特殊字符（\ % _），再把 * ? 转成通配符
  const like = q
    .replace(/[\\%_]/g, (m) => '\\' + m)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_')
  return { like, anchored }
}

/** 把通配符模式转为大小写不敏感的 JS 正则（无缓存兜底扫描用） */
export function wildcardToRegex(pattern) {
  let out = ''
  let anchored = false
  for (const ch of pattern) {
    if (ch === '*') {
      out += '.*'
      anchored = true
    } else if (ch === '?') {
      out += '.'
      anchored = true
    } else {
      out += ch.replace(/[\\^$+.()|[\]{}]/g, '\\$&')
    }
  }
  return new RegExp(anchored ? '^' + out + '$' : out, 'i')
}
