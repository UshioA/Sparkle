/**
 * 「把已有组/节点塞进某个选择组」——通用能力，不含任何协议或服务商信息。
 *
 * 为什么需要它：`+proxy-groups` 只能**新增顶层组**，改不了已有组里的成员
 * （`proxy-groups` 是数组，只能整体前插 / 整体替换）。而用户真正想要的是在
 * 「节点选择」里就能选到新加的那个组 —— 这需要改那个组的 `proxies`。
 * 这件事由客户端做掉，用户就不用再自己写覆写脚本了。
 *
 * extra-config.yaml 里这样用（和 target-core / requires-version 一样，
 * 这个键只是指令，不会出现在最终配置里）：
 *
 *   group-inject:
 *     - group: 节点选择          # 目标组名
 *       prepend: [mygroup]       # 插到该组成员列表最前面
 *     - group: MATCH             # 也可以用 MATCH：取 MATCH 规则指向的组
 *       append: [DIRECT]         # 追加到末尾
 *
 * 找不到目标组时只记一条日志、跳过，不影响配置生成。
 */

type ProxyGroup = {
  name?: string
  type?: string
  proxies?: unknown
}

type LooseProfile = {
  rules?: unknown
  'proxy-groups'?: unknown
}

export interface GroupInjectInstruction {
  group?: unknown
  prepend?: unknown
  append?: unknown
}

function asNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function matchTargetName(profile: LooseProfile): string {
  if (!Array.isArray(profile.rules)) return ''
  for (const rule of profile.rules) {
    const text = String(rule).trim()
    if (/^MATCH\s*,/i.test(text)) {
      const parts = text.split(',')
      return (parts[parts.length - 1] || '').trim()
    }
  }
  return ''
}

/**
 * 就地修改 profile['proxy-groups']，返回一串给日志看的说明。
 */
export function applyGroupInject(profile: LooseProfile, instructions: unknown): string[] {
  if (!Array.isArray(instructions) || instructions.length === 0) return []

  const groups = Array.isArray(profile['proxy-groups'])
    ? (profile['proxy-groups'] as ProxyGroup[])
    : []
  if (groups.length === 0) return ['group-inject: 配置里没有 proxy-groups，已跳过']

  const notes: string[] = []

  for (const raw of instructions as GroupInjectInstruction[]) {
    if (!raw || typeof raw !== 'object') continue

    const wanted = typeof raw.group === 'string' ? raw.group.trim() : ''
    const prepend = asNameList(raw.prepend)
    const append = asNameList(raw.append)
    if (prepend.length === 0 && append.length === 0) continue

    let target: ProxyGroup | undefined
    if (/^MATCH$/i.test(wanted)) {
      const matchName = matchTargetName(profile)
      target = matchName ? groups.find((group) => group.name === matchName) : undefined
      if (!target) {
        notes.push(
          `group-inject: MATCH 规则指向的组${matchName ? `「${matchName}」` : ''}不存在，已跳过`
        )
        continue
      }
    } else {
      target = groups.find((group) => group.name === wanted)
      if (!target) {
        notes.push(`group-inject: 找不到组「${wanted}」，已跳过`)
        continue
      }
    }

    const current = asNameList(target.proxies)
    const merged = [...prepend, ...current, ...append].filter(
      (name, index, all) => name !== target.name && all.indexOf(name) === index
    )
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      target.proxies = merged
      notes.push(
        `group-inject: 已往「${target.name}」注入 ${[...prepend, ...append].join(', ')}`
      )
    }
  }

  return notes
}
