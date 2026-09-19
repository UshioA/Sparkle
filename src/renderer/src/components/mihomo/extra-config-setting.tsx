import React, { useState } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button } from '@heroui/react'
import { openExtraConfig, restartCore } from '@renderer/utils/ipc'
import { notify } from '@renderer/utils/notification'

/**
 * Generic escape hatch: whatever the user puts in `<dataDir>/extra-config.yaml`
 * gets merged into the runtime config handed to the core. Sparkle does not
 * interpret it — a third-party core can be configured from here.
 */
const ExtraConfigSetting: React.FC = () => {
  const [restarting, setRestarting] = useState(false)

  const handleOpen = async (): Promise<void> => {
    try {
      await openExtraConfig()
    } catch (e) {
      notify(e, { variant: 'danger' })
    }
  }

  const handleReload = async (): Promise<void> => {
    try {
      setRestarting(true)
      await restartCore()
      notify('已重新生成配置并重启内核', { variant: 'success' })
    } catch (e) {
      notify(e, { variant: 'danger' })
    } finally {
      setRestarting(false)
    }
  }

  return (
    <SettingCard header="附加配置">
      <SettingItem compatKey="legacy" title="extra-config.yaml" divider>
        <div className="flex gap-2">
          <Button size="sm" onPress={handleOpen}>
            打开配置文件
          </Button>
          <Button size="sm" color="primary" isLoading={restarting} onPress={handleReload}>
            重新加载并重启内核
          </Button>
        </div>
      </SettingItem>
      <div className="px-4 pb-3 text-xs text-gray-500 leading-5">
        文件在数据目录里（Windows 为{' '}
        <code>%APPDATA%\sparkle</code>，Linux 为 <code>~/.config/sparkle</code>）。内容会合并进运行时配置：
        <code>+proxies</code> / <code>+proxy-groups</code> / <code>+rules</code> 追加到对应列表前面，其它键按对象合并。
        <code>target-core</code> 和 <code>requires-version</code> 用来限定只有合适的内核才会注入；文件不存在或解析失败时自动跳过，不影响内核启动。
      </div>
    </SettingCard>
  )
}

export default ExtraConfigSetting
