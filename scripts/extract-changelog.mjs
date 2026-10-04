#!/usr/bin/env node
// 从 CHANGELOG.md 抽取指定版本的小节，供 release workflow 生成 release notes。
// 用法：node scripts/extract-changelog.mjs v1.1.4 > RELEASE_NOTES.md
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const tag = process.argv[2] || ''
const version = tag.replace(/^v/i, '').trim()

const changelog = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8')

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const versionHeading = new RegExp(`^## \\[${escapeRe(version)}\\]`, 'm')
const unreleasedHeading = /^## \[Unreleased\]/m

// 优先匹配 tag 对应版本；找不到时退回 Unreleased，避免 release body 为空。
const versionAt = changelog.search(versionHeading)
const at = versionAt !== -1 ? versionAt : changelog.search(unreleasedHeading)
if (at === -1) process.exit(0)

const rest = changelog.slice(at)
const nextRel = rest.slice(1).search(/^## \[/m)
const section = (nextRel === -1 ? rest : rest.slice(0, nextRel + 1))
  .split('\n')
  .filter((line) => !/^\[[^\]]+\]:\s+https?:\/\//.test(line))
  .join('\n')
  .trim()

process.stdout.write(section ? `${section}\n` : '')
