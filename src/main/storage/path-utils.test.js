import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  absFromRel,
  baseName,
  dirName,
  extName,
  isInsideRoot,
  isRemotePath,
  joinPath,
  relFromRoot,
  toSlash,
  trimTrailingSlash
} from './path-utils'

describe('远程路径判定与规范化', () => {
  it('isRemotePath 只认带 scheme 的伪 URL', () => {
    expect(isRemotePath('webdav://host/a')).toBe(true)
    expect(isRemotePath('C:\\images')).toBe(false)
    expect(isRemotePath('/mnt/img')).toBe(false)
    expect(isRemotePath(null)).toBe(false)
  })

  it('toSlash / trimTrailingSlash', () => {
    expect(toSlash('a\\b\\c')).toBe('a/b/c')
    expect(trimTrailingSlash('webdav://host/dir/')).toBe('webdav://host/dir')
    expect(trimTrailingSlash('webdav://host')).toBe('webdav://host')
  })
})

describe('joinPath', () => {
  it('远程：拼接并规范化斜杠', () => {
    expect(joinPath('webdav://host', 'a', 'b/c')).toBe('webdav://host/a/b/c')
    expect(joinPath('webdav://host/', ['a', 'b'])).toBe('webdav://host/a/b')
  })

  it('本地：等价于 path.join', () => {
    const root = join('/tmp', 'root')
    expect(joinPath(root, 'a', 'b')).toBe(join(root, 'a', 'b'))
  })
})

describe('relFromRoot / absFromRel', () => {
  it('远程：取相对路径并还原', () => {
    expect(relFromRoot('webdav://host/root', 'webdav://host/root/a/b')).toBe('a/b')
    expect(relFromRoot('webdav://host/root', 'webdav://host/root')).toBe('')
    expect(relFromRoot('webdav://host/root', 'webdav://host/other')).toBe('')
    expect(absFromRel('webdav://host/root', '/a//b')).toBe('webdav://host/root/a/b')
    expect(absFromRel('webdav://host/root', '')).toBe('webdav://host/root')
  })
})

describe('isInsideRoot', () => {
  it('本地：非法路径被拒绝', () => {
    const root = join('/tmp', 'root')
    expect(isInsideRoot(null, join(root, 'a.jpg'))).toBe(false)
    expect(isInsideRoot(root, '')).toBe(false)
  })

  it('本地：允许子路径，拒绝自身与越界', () => {
    const root = join('/tmp', 'root')
    expect(isInsideRoot(root, join(root, 'a', 'b.jpg'))).toBe(true)
    expect(isInsideRoot(root, root)).toBe(false)
    expect(isInsideRoot(root, join(root, '..', 'secret.txt'))).toBe(false)
  })

  it('Windows 跨盘符视为越界', () => {
    if (process.platform !== 'win32') return
    expect(isInsideRoot('C:\\root', 'D:\\root\\a.jpg')).toBe(false)
  })

  it('远程：按前缀判定，拒绝相似前缀与自身', () => {
    expect(isInsideRoot('webdav://h/root', 'webdav://h/root/a/b')).toBe(true)
    expect(isInsideRoot('webdav://h/root', 'webdav://h/rootx/a')).toBe(false)
    expect(isInsideRoot('webdav://h/root', 'webdav://h/root')).toBe(false)
  })
})

describe('名称工具', () => {
  it('baseName / extName / dirName 兼容远程与本地', () => {
    expect(baseName('webdav://h/a/b.PNG')).toBe('b.PNG')
    expect(extName('webdav://h/a/b.PNG')).toBe('.png')
    expect(dirName('webdav://h/a/b.PNG')).toBe('webdav://h/a')

    const local = join('/tmp', 'dir', 'foo.tar.gz')
    expect(baseName(local)).toBe('foo.tar.gz')
    expect(extName(local)).toBe('.gz')
    expect(dirName(local)).toBe(join('/tmp', 'dir'))
  })

  it('无扩展名返回空字符串', () => {
    expect(extName('webdav://h/README')).toBe('')
  })
})
