import React, { useEffect, useState } from 'react'
import { Button, Input, Select, SelectItem } from '@heroui/react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { clearAccountProviderCache, restartCore } from '@renderer/utils/ipc'
import { notify } from '@renderer/utils/notification'

const noneKey = '__none__'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalize(accounts: AccountItem[]): AccountItem[] {
  return accounts.map((item) => ({
    ...item,
    name: item.name.trim(),
    email: item.email.trim(),
    interval: item.interval && item.interval > 0 ? item.interval : 3600
  }))
}

/**
 * 账号节点：保存多个账号，同一时刻只启用其中一个。
 * 选择某个账号后会清掉 provider 缓存并重启内核，用新账号重新拉取节点列表。
 */
const AccountSetting: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const accounts = appConfig?.accounts ?? []
  const activeAccountId = appConfig?.activeAccountId ?? ''
  const [draft, setDraft] = useState<AccountItem[]>(accounts)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    setDraft(accounts)
  }, [accounts])

  const dirty = JSON.stringify(draft) !== JSON.stringify(accounts)

  const update = (index: number, patch: Partial<AccountItem>): void => {
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addAccount = (): void => {
    setDraft((prev) => [
      ...prev,
      { id: createId(), name: '', email: '', password: '', interval: 3600 }
    ])
  }

  const removeAccount = (index: number): void => {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const apply = async (nextAccounts: AccountItem[], nextActiveId: string): Promise<void> => {
    setApplying(true)
    try {
      const accountsToSave = normalize(nextAccounts)
      const activeId = accountsToSave.some((item) => item.id === nextActiveId) ? nextActiveId : ''
      await patchAppConfig({ accounts: accountsToSave, activeAccountId: activeId })
      setDraft(accountsToSave)
      await clearAccountProviderCache()
      await restartCore()
      notify(activeId ? '账号已应用，正在重新拉取节点列表' : '已停用账号节点', {
        variant: 'success'
      })
    } catch (e) {
      notify(e, { variant: 'danger' })
    } finally {
      setApplying(false)
    }
  }

  return (
    <SettingCard header="账号节点">
      <SettingItem compatKey="legacy" title="当前账号" divider>
        <Select
          aria-label="当前账号"
          className="w-50"
          size="sm"
          selectedKeys={new Set([activeAccountId || noneKey])}
          disallowEmptySelection={true}
          onSelectionChange={(keys) => {
            const id = keys.currentKey === noneKey ? '' : (keys.currentKey as string)
            void apply(draft, id)
          }}
        >
          {[
            <SelectItem key={noneKey}>不使用</SelectItem>,
            ...draft.map((item) => (
              <SelectItem key={item.id}>{item.name || item.email || item.id}</SelectItem>
            ))
          ]}
        </Select>
      </SettingItem>

      {draft.map((item, index) => (
        <div key={item.id} className="border-t border-default-100 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm">{item.name || item.email || `账号 ${index + 1}`}</span>
            <Button size="sm" color="danger" variant="light" onPress={() => removeAccount(index)}>
              删除
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              size="sm"
              placeholder="名称"
              value={item.name}
              onValueChange={(value) => update(index, { name: value })}
            />
            <Input
              size="sm"
              placeholder="邮箱 / 用户名"
              value={item.email}
              onValueChange={(value) => update(index, { email: value })}
            />
            <Input
              size="sm"
              type="password"
              placeholder="密码"
              value={item.password}
              onValueChange={(value) => update(index, { password: value })}
            />
            <Input
              size="sm"
              type="number"
              placeholder="刷新间隔（秒）"
              value={String(item.interval ?? 3600)}
              onValueChange={(value) => update(index, { interval: parseInt(value) || 3600 })}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" variant="flat" onPress={addAccount}>
          添加账号
        </Button>
        {dirty && (
          <Button
            size="sm"
            color="primary"
            isLoading={applying}
            onPress={() => apply(draft, activeAccountId)}
          >
            保存并应用
          </Button>
        )}
      </div>
      <div className="px-4 pb-3 text-xs leading-5 text-gray-500">
        选择账号后会使用该账号的凭据重新拉取节点列表，并清掉上一个账号的节点。
      </div>
    </SettingCard>
  )
}

export default AccountSetting
