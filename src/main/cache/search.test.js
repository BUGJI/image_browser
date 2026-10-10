import { describe, expect, it } from 'vitest'
import { foldText } from '../cache-db-utils.mjs'
import {
  buildNameMatcher,
  likeEscape,
  mergeSearchResults,
  nameMatchScore,
  wildcardToRegex
} from './search'

describe('foldText', () => {
  it('做全 Unicode 小写折叠（不止 ASCII）', () => {
    expect(foldText('Ärger.JPG')).toBe('ärger.jpg')
    expect(foldText('Café.PNG')).toBe('café.png')
    expect(foldText('STRASSE')).toBe('strasse')
    expect(foldText('图片')).toBe('图片')
    expect(foldText(null)).toBe('')
  })
})

describe('likeEscape', () => {
  it('转义 LIKE 特殊字符 \\ % _', () => {
    expect(likeEscape(String.raw`a%b_c\d`)).toBe(String.raw`a\%b\_c\\d`)
    expect(likeEscape('plain')).toBe('plain')
  })
})

describe('nameMatchScore', () => {
  it('完全 / 前缀 / 子串 / 未命中', () => {
    expect(nameMatchScore('cat.jpg', 'cat.jpg', false)).toBe(100)
    expect(nameMatchScore('cat.jpg', 'cat', false)).toBe(80)
    expect(nameMatchScore('my-cat.jpg', 'cat', false)).toBe(60)
    expect(nameMatchScore('dog.jpg', 'cat', false)).toBe(0)
  })

  it('大小写不敏感、通配符模式统一 60、空查询 0', () => {
    expect(nameMatchScore('CAT.JPG', 'cat', false)).toBe(80)
    expect(nameMatchScore('anything', 'a*', true)).toBe(60)
    expect(nameMatchScore('anything', '', false)).toBe(0)
  })
})

describe('mergeSearchResults', () => {
  it('按 abs_path 去重、权重降序、同权重按目录/文件名', () => {
    const nameRows = [
      { abs_path: '1', name: 'cat', folder: 'b' },
      { abs_path: '2', name: 'dog.jpg', folder: 'a' }
    ]
    const textRows = [
      { abs_path: '2', name: 'dog.jpg', folder: 'a' },
      { abs_path: '3', name: 'e.jpg', folder: 'a' }
    ]
    const out = mergeSearchResults(nameRows, textRows, 'cat', false)
    expect(out.map((x) => x.row.abs_path)).toEqual(['1', '2', '3'])
    expect(out[0]).toMatchObject({ score: 100, match: 'name' })
    // abs_path=2 文件名未命中，被文字命中提升到 40，但保持 name 标记
    expect(out[1]).toMatchObject({ score: 40, match: 'name' })
    expect(out[2]).toMatchObject({ score: 40, match: 'text' })
  })

  it('空输入返回空数组', () => {
    expect(mergeSearchResults([], [], 'cat', false)).toEqual([])
  })
})

describe('buildNameMatcher', () => {
  it('通配符整体匹配', () => {
    expect(buildNameMatcher('cat*')).toEqual({ like: 'cat%', anchored: true })
    expect(buildNameMatcher('a?b')).toEqual({ like: 'a_b', anchored: true })
  })

  it('普通查询按子串匹配并转义 LIKE 特殊字符', () => {
    expect(buildNameMatcher('a_b')).toEqual({ like: String.raw`a\_b`, anchored: false })
    expect(buildNameMatcher('50%')).toEqual({ like: String.raw`50\%`, anchored: false })
  })

  it('like 统一折叠为小写（配合 name_fold 列，覆盖非 ASCII）', () => {
    expect(buildNameMatcher('Ärger')).toEqual({ like: 'ärger', anchored: false })
    expect(buildNameMatcher('PHOTO*')).toEqual({ like: 'photo%', anchored: true })
  })

  it('空输入返回 null', () => {
    expect(buildNameMatcher('   ')).toBeNull()
    expect(buildNameMatcher(null)).toBeNull()
  })
})

describe('wildcardToRegex', () => {
  it('* / ? 转为通配并锚定', () => {
    expect(wildcardToRegex('cat*').test('cat.jpg')).toBe(true)
    expect(wildcardToRegex('cat*').test('my-cat.jpg')).toBe(false)
    expect(wildcardToRegex('a?b').test('a1b')).toBe(true)
    expect(wildcardToRegex('a?b').test('a12b')).toBe(false)
  })

  it('正则元字符被转义、大小写不敏感、无通配时不锚定', () => {
    const re = wildcardToRegex('a.b')
    expect(re.test('xa.bx')).toBe(true)
    expect(re.test('aXb')).toBe(false)
    expect(wildcardToRegex('CAT').test('cat')).toBe(true)
  })
})
