import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from 'fs/promises'
import { existsSync, type Stats } from 'fs'
import path from 'path'
import { ensureCoreReadable, isCoreReadable, type CoreAccessLog } from './coreAccess'

export interface CoreCacheOptions {
  /** 数据目录（便携版是 <exe>/data，安装版是 userData）。测试时可显式传入。 */
  baseDir?: string
  log?: CoreAccessLog
}

interface CoreCacheMetaEntry {
  fingerprint: string
  sourcePath: string
  sourceSize: number
  sourceMtimeMs: number
  userPath?: string
  servicePath?: string
  updatedAt: number
}

interface CoreCacheMeta {
  version: number
  entries: Record<string, CoreCacheMetaEntry>
}

const metaVersion = 1
const userCacheDirName = 'core-cache'
const serviceCacheDirName = 'service-core'
const metaFileName = 'meta.json'

export function coreFileParts(corePath: string): { name: string; ext: string } {
  const ext = path.extname(corePath)
  const name = path.basename(corePath, ext)
  return { name, ext }
}

async function resolveBaseDir(options: CoreCacheOptions): Promise<string | undefined> {
  if (options.baseDir) return options.baseDir
  try {
    const { dataDir } = await import('../utils/dirs')
    return dataDir()
  } catch (error) {
    await options.log?.(`[CoreCache]: 解析数据目录失败，${error}\n`)
    return undefined
  }
}

function fingerprintOf(sourceStat: Stats): string {
  return `${sourceStat.size}-${Math.floor(sourceStat.mtimeMs)}`
}

function userCachePath(baseDir: string, name: string, ext: string): string {
  return path.join(baseDir, userCacheDirName, `${name}${ext}`)
}

function serviceCachePath(baseDir: string, fingerprint: string, name: string, ext: string): string {
  return path.join(baseDir, serviceCacheDirName, fingerprint, `${name}${ext}`)
}

function metaPath(baseDir: string): string {
  return path.join(baseDir, userCacheDirName, metaFileName)
}

async function statSafe(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file)
  } catch {
    return undefined
  }
}

function isUpToDate(targetStat: Stats, sourceStat: Stats): boolean {
  return (
    targetStat.size === sourceStat.size &&
    Math.floor(targetStat.mtimeMs) === Math.floor(sourceStat.mtimeMs)
  )
}

async function copyAtomic(source: string, target: string): Promise<boolean> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, tmp)
    // 保留源文件的 mtime，之后才能用 size+mtime 判断副本是否还有效。
    const sourceStat = await statSafe(source)
    if (sourceStat) {
      await utimes(tmp, sourceStat.atime, sourceStat.mtime).catch(() => {})
    }
    await rename(tmp, target)
    return true
  } catch {
    await rm(tmp, { force: true }).catch(() => {})
    return false
  }
}

async function readMeta(baseDir: string): Promise<CoreCacheMeta> {
  const fallback: CoreCacheMeta = { version: metaVersion, entries: {} }
  try {
    const raw = await readFile(metaPath(baseDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CoreCacheMeta>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
      return fallback
    }
    return { version: metaVersion, entries: parsed.entries ?? {} }
  } catch {
    return fallback
  }
}

async function writeMetaEntry(
  baseDir: string,
  key: string,
  entry: Omit<CoreCacheMetaEntry, 'updatedAt'>
): Promise<void> {
  const meta = await readMeta(baseDir)
  meta.entries[key] = { ...meta.entries[key], ...entry, updatedAt: Date.now() }
  const target = metaPath(baseDir)
  const tmp = `${target}.${process.pid}.tmp`
  try {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(meta, null, 2))
    await rename(tmp, target)
  } catch {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

async function pruneServiceCaches(
  baseDir: string,
  keepFingerprint: string,
  log?: CoreAccessLog
): Promise<void> {
  const dir = path.join(baseDir, serviceCacheDirName)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry !== keepFingerprint)
      .map(async (entry) => {
        try {
          await rm(path.join(dir, entry), { recursive: true, force: true })
        } catch (error) {
          await log?.(`[CoreCache]: 清理旧服务内核副本失败 ${entry}，${error}\n`)
        }
      })
  )
}

type PathProbe = 'readable' | 'inaccessible' | 'missing'

async function probePath(file: string): Promise<PathProbe> {
  try {
    await stat(file)
    return 'readable'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code === 'EACCES' || code === 'EPERM' ? 'inaccessible' : 'missing'
  }
}

/**
 * 保证用户侧有一份可读的内核副本。
 *
 * - 源可读（或能自愈）时：把源同步到 <dataDir>/core-cache/<name><ext>，返回源路径。
 * - 源不可读且无法自愈时：返回可读的 core-cache 副本路径作为兜底。
 * - 非 Windows 平台直接返回原路径（不复制 setuid 二进制）。
 */
export async function ensureUserCoreCache(
  corePath: string,
  name: string,
  ext: string,
  options: CoreCacheOptions = {}
): Promise<string> {
  if (process.platform !== 'win32') return corePath

  const baseDir = await resolveBaseDir(options)
  if (!baseDir) return corePath

  const target = userCachePath(baseDir, name, ext)
  const sourceReadable =
    isCoreReadable(corePath) || (await ensureCoreReadable(corePath, options.log))

  if (sourceReadable) {
    const sourceStat = await statSafe(corePath)
    const targetStat = await statSafe(target)
    if (sourceStat && (!targetStat || !isUpToDate(targetStat, sourceStat))) {
      if (await copyAtomic(corePath, target)) {
        await writeMetaEntry(baseDir, `${name}${ext}`, {
          fingerprint: fingerprintOf(sourceStat),
          sourcePath: corePath,
          sourceSize: sourceStat.size,
          sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
          userPath: target
        })
      } else {
        await options.log?.(`[CoreCache]: 更新用户内核副本失败 ${target}\n`)
      }
    }
    return corePath
  }

  if (isCoreReadable(target)) {
    await options.log?.(`[CoreCache]: 源内核不可读，使用缓存副本 ${target}\n`)
    return target
  }

  await options.log?.(`[CoreCache]: 源内核不可读且没有可用缓存副本 ${corePath}\n`)
  return corePath
}

/**
 * 为服务进程准备一份只属于服务的内核副本，返回给服务的 core_path。
 *
 * 服务会加固这个副本所在的目录；原 resources\\sidecar 和用户提供的系统内核文件
 * 因此始终可读。副本目录带指纹：内核变化时换新目录，旧目录由 app 尽力清理。
 */
export async function ensureServiceCoreCopy(
  srcPath: string,
  name: string,
  ext: string,
  options: CoreCacheOptions = {}
): Promise<string> {
  if (process.platform !== 'win32') return srcPath

  const baseDir = await resolveBaseDir(options)
  if (!baseDir) return srcPath

  const key = `${name}${ext}`
  const meta = await readMeta(baseDir)
  const recorded = meta.entries[key]

  let sourcePath = srcPath
  let sourceStat = await statSafe(sourcePath)
  if (!sourceStat || !isCoreReadable(sourcePath)) {
    if (await ensureCoreReadable(sourcePath, options.log)) {
      sourceStat = await statSafe(sourcePath)
    } else {
      sourceStat = undefined
    }
  }

  if (!sourceStat) {
    // 源不可读：优先用用户可读的 core-cache 副本再复制一份给服务。
    const userCopy = userCachePath(baseDir, name, ext)
    if (isCoreReadable(userCopy)) {
      sourcePath = userCopy
      sourceStat = await statSafe(userCopy)
    }
  }

  if (sourceStat) {
    const fingerprint = fingerprintOf(sourceStat)
    const target = serviceCachePath(baseDir, fingerprint, name, ext)
    if (recorded?.fingerprint === fingerprint && recorded.servicePath === target) {
      return target
    }

    const probe = await probePath(target)
    if (probe === 'readable') {
      await writeMetaEntry(baseDir, key, {
        fingerprint,
        sourcePath,
        sourceSize: sourceStat.size,
        sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
        servicePath: target
      })
      await pruneServiceCaches(baseDir, fingerprint, options.log)
      return target
    }

    if (probe === 'missing') {
      if (await copyAtomic(sourcePath, target)) {
        await options.log?.(`[CoreCache]: 已生成服务内核副本 ${target}\n`)
        await writeMetaEntry(baseDir, key, {
          fingerprint,
          sourcePath,
          sourceSize: sourceStat.size,
          sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
          servicePath: target
        })
        await pruneServiceCaches(baseDir, fingerprint, options.log)
        return target
      }
      // 复制失败也可能是因为目录已被服务加固，此时副本通常已经存在。
      if ((await probePath(target)) === 'inaccessible') {
        await writeMetaEntry(baseDir, key, {
          fingerprint,
          sourcePath,
          sourceSize: sourceStat.size,
          sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
          servicePath: target
        })
        return target
      }
      await options.log?.(`[CoreCache]: 生成服务内核副本失败 ${target}\n`)
    } else {
      // 目录被服务加固，普通用户读不了但 SYSTEM 能读，沿用这个确定性路径。
      await writeMetaEntry(baseDir, key, {
        fingerprint,
        sourcePath,
        sourceSize: sourceStat.size,
        sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
        servicePath: target
      })
      return target
    }
  }

  if (recorded?.servicePath) {
    await options.log?.(`[CoreCache]: 源内核不可读，沿用历史服务内核副本 ${recorded.servicePath}\n`)
    return recorded.servicePath
  }

  await options.log?.(`[CoreCache]: 无法准备服务内核副本 ${srcPath}\n`)
  return srcPath
}

/** 启动早期调用：源可读时先把用户侧副本做出来，之后才有兜底。 */
export async function primeUserCoreCache(
  corePath: string,
  options: CoreCacheOptions = {}
): Promise<void> {
  if (process.platform !== 'win32') return
  if (!existsSync(corePath)) return

  const { name, ext } = coreFileParts(corePath)
  await ensureUserCoreCache(corePath, name, ext, options)
}
