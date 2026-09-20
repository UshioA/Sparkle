/**
 * User supplied "extra config" fragment.
 *
 * Sparkle merges whatever is in `<dataDir>/extra-config.yaml` into the runtime
 * config it hands to the core. Sparkle itself stays protocol agnostic: it only
 * reads a file and merges it, so any third-party core can be driven from here.
 *
 * The file uses the same merge semantics as the override feature
 * (`+proxies` / `+proxy-groups` / `+rules` prepend, other keys merge as
 * objects), plus two optional gate keys that are *not* merged:
 *
 *   target-core: system | always   only inject when this core is selected
 *   requires-version: <marker>     require `<system core> -v` to contain marker
 *
 * Both gates exist so a fragment written for a third-party core can never be
 * fed to the bundled core, which would refuse to start on unknown config.
 */
import { existsSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { dataDir, mihomoCorePath } from '../utils/dirs'
import { parseYaml } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { applyGroupInject } from './groupInject'
import { appendAppLog } from '../utils/log'

export const extraConfigName = 'extra-config.yaml'

export function extraConfigPath(): string {
  return path.join(dataDir(), extraConfigName)
}

const extraConfigTemplate = `# Sparkle 附加配置（用户自备）
#
# 这里写的内容会在生成运行时配置时合并进去，语法与「覆盖」一致：
#   +proxies / +proxy-groups / +rules  → 追加到对应列表前面（key+ 则是追加到后面）
#   其它键（例如 proxy-providers）      → 按对象合并；写不写 + 都行，但为了兼容旧版本建议直接写
#
# 下面这些键是"控制键"，只是用来决定/调整注入，不会写进最终配置：
#   target-core: system | always   默认 system：只有内核设置里选了「系统内核」才注入
#   requires-version: <marker>    注入前执行 <系统内核> -v，输出里必须包含该字符串
#   group-inject: [...]            把新加的组塞进已有的选择组（见文末例子），实现里不需要覆写脚本
#
# 例子（给自定义内核加一个 provider 和选择组）：
#
# target-core: system
# requires-version: <marker>     # 一般填内核 -v 输出里的特征串
# proxy-providers:        # 对象键：直接写（旧版本上 +proxy-providers 会被当成字面量键，provider 不会注册）
#   myprovider:
#     type: mytype
#     interval: 3600
# +proxy-groups:
#   - { name: mygroup, type: select, use: [myprovider] }
#
# 想让它在「节点选择」里直接可选？（proxy-groups 是数组，普通合并改不了已有组里的成员）
# group-inject:
#   - group: 节点选择            # 目标组名；写 MATCH 表示 MATCH 规则指向的那个组
#     prepend: [mygroup]         # 插到成员列表最前面（append 则是追加到末尾）
`

export function ensureExtraConfigFile(): string {
  const file = extraConfigPath()
  if (!existsSync(file)) {
    writeFileSync(file, extraConfigTemplate, 'utf-8')
  }
  return file
}

interface ExtraConfigGate {
  'target-core'?: string
  'requires-version'?: string
}

async function systemCoreVersion(): Promise<string | undefined> {
  try {
    const execFilePromise = promisify(execFile)
    const { stdout, stderr } = await execFilePromise(mihomoCorePath('system'), ['-v'], {
      timeout: 5000,
      windowsHide: true
    })
    return `${stdout}${stderr}`.trim()
  } catch (e) {
    await appendAppLog(`[ExtraConfig]: 读取系统内核版本失败：${e}\n`)
    return undefined
  }
}

export async function applyExtraConfig(profile: MihomoConfig, core: string): Promise<void> {
  const file = extraConfigPath()
  if (!existsSync(file)) return

  let parsed: unknown
  try {
    parsed = parseYaml<unknown>(await readFile(file, 'utf-8'))
  } catch (e) {
    await appendAppLog(`[ExtraConfig]: ${extraConfigName} 解析失败，已跳过：${e}\n`)
    return
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return

  const {
    'target-core': targetCore = 'system',
    'requires-version': requiresVersion,
    'group-inject': groupInject,
    ...body
  } = parsed as ExtraConfigGate & Record<string, unknown>

  // 只有 group-inject（不合并任何东西）也是合法用法：往已有的组里塞成员
  if (Object.keys(body).length === 0 && groupInject === undefined) return

  if (targetCore === 'system' && core !== 'system') {
    await appendAppLog(
      `[ExtraConfig]: 当前内核为 ${core}，与 target-core: system 不匹配，已跳过 ${extraConfigName}\n`
    )
    return
  }

  if (requiresVersion) {
    const version = await systemCoreVersion()
    if (!version || !version.includes(String(requiresVersion))) {
      await appendAppLog(
        `[ExtraConfig]: 系统内核版本里没有 "${requiresVersion}"，已跳过 ${extraConfigName}（避免把不支持的配置喂给它）\n`
      )
      return
    }
  }

  deepMerge(profile, body as Partial<MihomoConfig>, true)

  // 把指定组塞进已有选择组（proxy-groups 是数组，deepMerge 只能整体前插/替换）
  for (const note of applyGroupInject(profile, groupInject)) {
    await appendAppLog(`[ExtraConfig]: ${note}\n`)
  }

  await appendAppLog(`[ExtraConfig]: 已合并 ${extraConfigName}\n`)
}
