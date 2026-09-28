import path from 'path'
import os from 'os'
import type { CoreStartupHook } from './startupHook'
import { mihomoIpcPath, mihomoProfileWorkDir, mihomoWorkDir } from '../utils/dirs'

interface RuntimeConfigProviders {
  'rule-providers'?: Record<string, unknown>
  'proxy-providers'?: Record<string, unknown>
}

export interface CoreEnvironmentOptions {
  disableLoopbackDetector: boolean
  disableEmbedCA: boolean
  disableSystemCA: boolean
  disableNftables: boolean
  safePaths: string[]
}

export interface CoreSpawnArgsOptions {
  current: string | undefined
  diffWorkDir: boolean
  ctlParam: string
  coreHook?: CoreStartupHook
}

export interface ProviderInitializationTracker {
  hasProviders: boolean
  track: (logLine: string) => void
  isReady: (logLine: string) => boolean
}

// 内核是独立进程，需要知道用户目录（例如按 "~" 解析路径）和临时目录。
// Node 的 `env` 选项是整体替换而不是继承 process.env，所以这里显式透传与路径
// 相关的用户环境变量；缺失时用 os.homedir() 兜底，避免 service/SYSTEM 等精简
// 环境下 "~" 无法展开。
const coreEnvPassthroughKeys = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR'
] as const

function createCoreUserEnvironment(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const key of coreEnvPassthroughKeys) {
    const value = process.env[key]
    if (value) env[key] = value
  }

  let home: string
  try {
    home = os.homedir()
  } catch {
    home = ''
  }
  if (home) {
    env.HOME ??= home
    env.USERPROFILE ??= home
  }

  return env
}

export function createCoreEnvironment(
  options: CoreEnvironmentOptions
): Record<string, string | undefined> {
  return {
    DISABLE_LOOPBACK_DETECTOR: String(options.disableLoopbackDetector),
    DISABLE_EMBED_CA: String(options.disableEmbedCA),
    DISABLE_SYSTEM_CA: String(options.disableSystemCA),
    DISABLE_NFTABLES: String(options.disableNftables),
    SAFE_PATHS: options.safePaths.join(path.delimiter),
    ...createCoreUserEnvironment()
  }
}

export function createCoreSpawnArgs(options: CoreSpawnArgsOptions): string[] {
  const spawnArgs = [
    '-d',
    options.diffWorkDir ? mihomoProfileWorkDir(options.current) : mihomoWorkDir(),
    options.ctlParam,
    mihomoIpcPath()
  ]

  if (options.coreHook) {
    spawnArgs.push(
      '-post-up',
      options.coreHook.postUpCommand,
      '-post-down',
      options.coreHook.postDownCommand
    )
  }

  return spawnArgs
}

export function createProviderInitializationTracker(
  runtimeConfig: RuntimeConfigProviders
): ProviderInitializationTracker {
  const providerNames = new Set(
    [
      ...Object.keys(runtimeConfig['rule-providers'] || {}),
      ...Object.keys(runtimeConfig['proxy-providers'] || {})
    ].map(normalizeProviderName)
  )
  const unmatchedProviders = new Set(providerNames)

  return {
    hasProviders: providerNames.size > 0,
    track: (logLine) => {
      for (const match of logLine.matchAll(/Start initial provider ([^"]+)"/g)) {
        const name = normalizeProviderName(match[1])
        if (providerNames.has(name)) {
          unmatchedProviders.delete(name)
        }
      }
    },
    isReady: (logLine) => {
      const isDefaultProvider = logLine.includes('Start initial compatible provider default')
      const isAllProvidersMatched = providerNames.size > 0 && unmatchedProviders.size === 0
      return (providerNames.size === 0 && isDefaultProvider) || isAllProvidersMatched
    }
  }
}

export function isControllerListenError(logLine: string): boolean {
  return (
    (process.platform !== 'win32' && logLine.includes('External controller unix listen error')) ||
    (process.platform === 'win32' && logLine.includes('External controller pipe listen error'))
  )
}

export function isControllerReadyLog(logLine: string): boolean {
  return (
    (process.platform !== 'win32' && logLine.includes('RESTful API unix listening at')) ||
    (process.platform === 'win32' && logLine.includes('RESTful API pipe listening at'))
  )
}

export function isTunPermissionError(logLine: string): boolean {
  return logLine.includes(
    'Start TUN listening error: configure tun interface: operation not permitted'
  )
}

export function isUpdaterFinishedLog(logLine: string): boolean {
  return process.platform === 'win32' && logLine.includes('updater: finished')
}

function normalizeProviderName(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .normalize('NFC')
}
