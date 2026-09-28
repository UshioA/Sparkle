import { accountProviderName, accountProviderType } from './accountConfig'

type AccountGroup = { name?: string; use?: string[]; proxies?: string[] } & Record<string, unknown>

/** 把 activeAccountId 对应的账号注入为一份 proxy-provider，并挂到主选择组。 */
export function applyAccountProvider(
  profile: MihomoConfig,
  appConfig: Pick<AppConfig, 'accounts' | 'activeAccountId'>
): void {
  const accounts = appConfig.accounts ?? []
  const active = accounts.find((item) => item.id === appConfig.activeAccountId)
  if (!active || !active.email?.trim() || !active.password) return

  const providerName = accountProviderName
  const groupName = active.name?.trim() || providerName
  const autoName = `${groupName}-自动`
  const providers = (profile['proxy-providers'] ?? {}) as Record<string, unknown>
  providers[providerName] = {
    type: accountProviderType,
    email: active.email.trim(),
    password: active.password,
    interval: active.interval && active.interval > 0 ? active.interval : 3600,
    'name-prefix': `${groupName}-`,
    'health-check': {
      enable: true,
      url: 'https://www.gstatic.com/generate_204',
      interval: 300
    }
  }
  profile['proxy-providers'] = providers as MihomoConfig['proxy-providers']

  const groups = (profile['proxy-groups'] ?? []) as AccountGroup[]
  const present = new Set(groups.map((group) => group?.name))
  const injected: AccountGroup[] = []
  if (!present.has(groupName)) {
    injected.push({ name: groupName, type: 'select', use: [providerName] })
  }
  if (!present.has(autoName)) {
    injected.push({
      name: autoName,
      type: 'url-test',
      use: [providerName],
      url: 'https://www.gstatic.com/generate_204',
      interval: 300,
      tolerance: 50
    })
  }
  profile['proxy-groups'] = [...injected, ...groups] as MihomoConfig['proxy-groups']

  const target = findAccountRoutingTarget(profile)
  if (target) {
    const proxies = (target.proxies ?? []) as string[]
    const add = [groupName, autoName].filter((item) => !proxies.includes(item))
    if (add.length > 0) target.proxies = [...add, ...proxies]
  }
}

function findAccountRoutingTarget(profile: MihomoConfig): AccountGroup | undefined {
  const groups = (profile['proxy-groups'] ?? []) as AccountGroup[]
  const rules = (profile['rules'] ?? []) as string[]
  for (let i = rules.length - 1; i >= 0; i--) {
    const match = /^MATCH\s*,\s*(.+)$/i.exec(String(rules[i]).trim())
    if (match) {
      const hit = groups.find((group) => group?.name === match[1].trim())
      if (hit) return hit
      break
    }
  }
  for (const candidate of ['节点选择', 'PROXY', '漏网之鱼', '代理', 'Proxy']) {
    const hit = groups.find((group) => group?.name === candidate)
    if (hit) return hit
  }
  return undefined
}
