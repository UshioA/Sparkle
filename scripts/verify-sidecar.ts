/**
 * 构建期护栏：`extra/sidecar` 里的内核必须是**官方 mihomo**。
 *
 * 为什么需要它：
 * - Sparkle 只内置官方内核（第三方内核以「系统内核」方式接入，见 README）；
 * - `extra/` 在 `.gitignore` 里，本地构建时手工放进去的内核会被 `electron-builder`
 *   原样打进发布包；
 * - `scripts/prepare.ts` 会被 `SKIP_PREPARE=1` 跳过，所以校验不能只写在 prepare 里，
 *   必须放在打包之前单独跑一遍。
 *
 * 两道检查：
 * 1. 动态：直接执行 `<core> -v`，要求版本串是官方形态：
 *      稳定版 `Mihomo Meta v1.19.31 ...`、预览版 `Mihomo Meta alpha-<hash> ...`；
 *      带自定义后缀的版本串（例如 `... v1.19.30-custom ...`）一律拒绝。
 * 2. 静态兜底：本机**跑不动**这个二进制时（典型：upstream 的 darwin-x64 core 是
 *    x86-64-v3（AVX2），而 GitHub 的 Intel runner 只到 v2，执行会直接失败），
 *    改为扫文件：必须是对应平台的可执行格式、含 `Mihomo Meta`，且不含
 *    `VERIFY_SIDECAR_FORBIDDEN` 里列出的标记（见下）。
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { systemCoreOnlyBuild } from './build-env.ts'

const cwd = process.cwd()
const ext = process.platform === 'win32' ? '.exe' : ''

// 官方形态：稳定版是纯 vX.Y.Z，预览版是 alpha-<hash>。
// 带自定义后缀的（例如 v1.19.30-custom）一律拒绝；上游如果改了命名，
// 这里会 fail-closed，按报错信息补正则即可（临时绕过可设 SKIP_VERIFY_SIDECAR=1）。
const OFFICIAL_VERSION = /^Mihomo Meta (v\d+\.\d+\.\d+|alpha-[0-9A-Za-z.]+)(?:\s|$)/
// 可选黑名单：VERIFY_SIDECAR_FORBIDDEN='sub1,sub2'（逗号分隔，大小写不敏感）。
// 命中的内置内核一律拒绝。CI 上通常不设置；本地构建可以用它额外挡住不想打包的第三方内核。
const FORBIDDEN_MARKERS = (process.env.VERIFY_SIDECAR_FORBIDDEN ?? '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter((item) => item !== '')

const MAGIC: Record<string, string[]> = {
  win32: ['4d5a'], // MZ
  linux: ['7f454c46'], // \x7fELF
  darwin: ['feedfacf', 'cffaedfe', 'feedface', 'cefaedfe', 'cafebabe', 'bebafeca', 'cafebabf']
}

function fail(message: string): never {
  console.error(`::error::[verify-sidecar] ${message}`)
  process.exit(1)
}

if (process.env.SKIP_VERIFY_SIDECAR === '1') {
  console.log('[verify-sidecar] SKIP_VERIFY_SIDECAR=1，跳过校验')
  process.exit(0)
}

if (systemCoreOnlyBuild) {
  console.log('[verify-sidecar] 系统内核模式构建（SPARKLE_SYSTEM_CORE），不打包内置内核，跳过校验')
  process.exit(0)
}

function assertExecutableFormat(file: string, relative: string): void {
  const allowed = MAGIC[process.platform]
  if (!allowed) return
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    // 按各平台 magic 的长度比较（MZ 只有 2 字节，后面几字节是 DOS stub，不固定）
    const matched = allowed.some((hex) => head.subarray(0, hex.length / 2).toString('hex') === hex)
    if (!matched) {
      fail(
        `${relative} 不是 ${process.platform} 平台的可执行文件（magic=${head.toString('hex')}）——` +
          `大概是 prepare 下载/改名弄错了。`
      )
    }
  } finally {
    fs.closeSync(fd)
  }
}

function readVersion(file: string, relative: string): string | undefined {
  try {
    const out = execFileSync(file, ['-v'], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true
    }).trim()
    if (out === '') {
      console.warn(`[verify-sidecar] ⚠️ ${relative} -v 没有任何输出，改用静态检查`)
      return undefined
    }
    return out
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string } | undefined)?.stderr
    const detail = (stderr ? String(stderr) : String(error)).trim().split('\n')[0]
    console.warn(`[verify-sidecar] ⚠️ 本机无法执行 ${relative} -v（${detail}），改用静态检查`)
    return undefined
  }
}

function staticCheck(file: string, relative: string): void {
  const raw = fs.readFileSync(file)
  const text = raw.toString('latin1')
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.toLowerCase().includes(marker)) {
      fail(
        `${relative} 命中了禁止标记「${marker}」，不是官方 mihomo。\n` +
          `        Sparkle 只允许内置官方内核；第三方内核请以「系统内核」方式接入（见 README）。`
      )
    }
  }
  if (!text.includes('Mihomo Meta')) {
    fail(`${relative} 里没有 "Mihomo Meta"，不像官方 mihomo 内核`)
  }
  console.log(`[verify-sidecar] ✅ ${relative}（静态检查：格式与标记检查通过）`)
}

for (const name of ['mihomo', 'mihomo-alpha']) {
  const relative = path.join('extra', 'sidecar', `${name}${ext}`)
  const file = path.join(cwd, relative)

  if (!fs.existsSync(file)) {
    fail(
      `内置内核缺失：${relative}。\n` +
        `        · 正常构建请先跑 \`pnpm prepare\`，它会从 MetaCubeX/mihomo 的 Release 拉官方内核；\n` +
        `        · 不要把第三方内核拷进 extra/sidecar —— 公开产物只能内置官方内核。`
    )
  }

  const { size } = fs.statSync(file)
  if (size < 10 * 1024 * 1024) {
    fail(`${relative} 只有 ${(size / 1024 / 1024).toFixed(1)}MB，不像官方内核（官方约 60MB）`)
  }

  assertExecutableFormat(file, relative)

  const version = readVersion(file, relative)
  if (version === undefined) {
    staticCheck(file, relative)
    continue
  }

  const firstLine = version.split('\n')[0]

  const marker = FORBIDDEN_MARKERS.find((m) => firstLine.toLowerCase().includes(m))
  if (marker) {
    fail(
      `${relative} 命中了禁止标记「${marker}」，不是官方 mihomo：\n` +
        `        ${firstLine}\n` +
        `        Sparkle 只允许内置官方内核；第三方内核请以「系统内核」方式接入（见 README）。`
    )
  }

  if (!OFFICIAL_VERSION.test(firstLine)) {
    fail(
      `${relative} 的版本串不是官方 mihomo 形态：\n` +
        `        ${firstLine}\n` +
        `        官方稳定版应为 \`Mihomo Meta vX.Y.Z ...\`，预览版应为 \`Mihomo Meta alpha-<hash> ...\`。`
    )
  }

  console.log(`[verify-sidecar] ✅ ${relative} -> ${firstLine}`)
}
