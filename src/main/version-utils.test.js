import { describe, expect, it } from 'vitest'
import { compareVersions, isStableVersionRelease, parseVersion } from './version-utils'

describe('parseVersion', () => {
  it('解析标准 v 前缀版本', () => {
    expect(parseVersion('v1.1.4')).toBe('1.1.4')
    expect(parseVersion('V1.2.3')).toBe('1.2.3')
    expect(parseVersion(' v1.0.0 ')).toBe('1.0.0')
    expect(parseVersion('v1.2')).toBe('1.2')
  })

  it('拒绝 OCR 运行时等非应用版本 tag', () => {
    expect(parseVersion('ocr-runtime-v1.22.0-rev_sharp-0.34.5')).toBeNull()
    expect(parseVersion('ocr-runtime-v2.0.0-rev_sharp-1.0.0')).toBeNull()
  })

  it('拒绝无 v 前缀 / 预发布 / 段数异常 / 非字符串', () => {
    expect(parseVersion('1.1.4')).toBeNull()
    expect(parseVersion('v1.1.4-beta.1')).toBeNull()
    expect(parseVersion('v1')).toBeNull()
    expect(parseVersion('v1.2.3.4')).toBeNull()
    expect(parseVersion('vv1.2.3')).toBeNull()
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(123)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('逐段数字比较', () => {
    expect(compareVersions('1.1.4', '1.1.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.999.999')).toBe(1)
  })

  it('段数不等时缺失段按 0 处理', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })
})

describe('isStableVersionRelease', () => {
  it('接受非 draft / 非 prerelease 的纯版本 tag', () => {
    expect(isStableVersionRelease({ tag_name: 'v1.1.4' })).toBe(true)
  })

  it('拒绝 OCR 组件、draft、prerelease 与空值', () => {
    expect(isStableVersionRelease({ tag_name: 'ocr-runtime-v1.22.0-rev_sharp-0.34.5' })).toBe(false)
    expect(isStableVersionRelease({ tag_name: 'v1.1.4', draft: true })).toBe(false)
    expect(isStableVersionRelease({ tag_name: 'v1.1.4', prerelease: true })).toBe(false)
    expect(isStableVersionRelease(null)).toBe(false)
  })
})
