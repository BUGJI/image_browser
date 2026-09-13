import { registerProvider } from './index'
import { ROOT_TYPE } from './types.js'
import { createWebdavProvider } from './webdav'

/**
 * 注册所有远程协议 Provider 工厂。
 * 在应用启动（secrets 表就绪后）调用一次。
 * SMB 将在后续阶段加入。
 */
export function registerRemoteProviders() {
  registerProvider(ROOT_TYPE.WEBDAV, createWebdavProvider)
}
