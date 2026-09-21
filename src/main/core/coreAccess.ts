import { execFile } from 'child_process'
import { closeSync, openSync } from 'fs'
import path from 'path'
import { getCurrentUserSid } from '@uruhalushia/sparkle-native'

const aclGrantTimeoutMs = 10 * 1000
const aclRepairableErrorCodes = new Set(['EACCES', 'EPERM', 'ENOENT'])

export type CoreAccessLog = (message: string) => void | Promise<void>

function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/** 只做「当前用户能否打开并读取」这一件事，不修改任何权限。 */
export function isCoreReadable(corePath: string): boolean {
  try {
    const fd = openSync(corePath, 'r')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

function grantReadExec(target: string, sid: string, inheritable: boolean): Promise<boolean> {
  // 目录上带 (OI)(CI) 才能把权限继承给子文件；文件本身不能带继承标记，
  // 否则 icacls 会写入一个 inherit-only 的 ACE，对文件本身不生效。
  const permission = inheritable ? `*${sid}:(OI)(CI)RX` : `*${sid}:RX`
  return new Promise((resolve) => {
    execFile(
      'icacls',
      [target, '/grant', permission],
      { timeout: aclGrantTimeoutMs, windowsHide: true },
      (error) => resolve(!error)
    )
  })
}

/**
 * 普通权限下确保内核文件可读可执行。
 *
 * 服务模式会把内核所在目录（或文件本身）的 ACL 收紧到 SYSTEM/Administrators，
 * 服务退出后普通用户可能连 exe 都打不开（spawn 得到 ENOENT/EPERM）。
 * 这里在 Windows 上对「用户自己拥有的目录」调用 icacls 补回 RX 权限；
 * 用户没有权限修复的目录（例如 Program Files）保持原样。
 *
 * 非 Windows 平台直接返回 true：setuid / chmod 那套权限逻辑不在这里处理。
 */
export async function ensureCoreReadable(corePath: string, log?: CoreAccessLog): Promise<boolean> {
  if (process.platform !== 'win32') return true
  if (isCoreReadable(corePath)) return true

  // 先确认失败原因值得尝试修复，避免对「文件真的不存在」等场景做无用功。
  let failure: unknown
  try {
    const fd = openSync(corePath, 'r')
    closeSync(fd)
    return true
  } catch (error) {
    failure = error
  }

  const code = errorCode(failure)
  if (!code || !aclRepairableErrorCodes.has(code)) {
    await log?.(
      `[CoreAccess]: 内核不可读且错误无法自动修复（${code ?? String(failure)}），${corePath}\n`
    )
    return false
  }

  let sid: string
  try {
    sid = getCurrentUserSid()
  } catch (error) {
    await log?.(`[CoreAccess]: 读取当前用户 SID 失败，无法修复 ${corePath}，${error}\n`)
    return false
  }
  if (!sid.startsWith('S-')) {
    await log?.(`[CoreAccess]: 当前用户 SID 无效（${sid}），无法修复 ${corePath}\n`)
    return false
  }

  // 目录被移除继承时，目录上的 (OI)(CI) 授权会重新继承到子文件。
  await grantReadExec(path.dirname(corePath), sid, true)
  if (!isCoreReadable(corePath)) {
    // 文件本身带显式 ACL（不继承父目录）时，需要单独对文件授权一次（不能带 (OI)(CI)）。
    await grantReadExec(corePath, sid, false)
  }

  const readable = isCoreReadable(corePath)
  await log?.(
    readable
      ? `[CoreAccess]: 已恢复内核读取权限 ${corePath}\n`
      : `[CoreAccess]: 自动恢复内核读取权限失败，可能需要管理员处理 ${corePath}\n`
  )
  return readable
}
