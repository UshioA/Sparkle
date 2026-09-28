import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import path from 'path'
import { dialog } from 'electron'
import { patchAppConfig } from '../config'
import { dataDir } from '../utils/dirs'
import { stopCore } from './manager'

/**
 * 选择一个内核可执行文件，复制到 <dataDir>/cores/ 并设为系统内核。
 *
 * 复制前先停掉当前内核，避免目标文件被占用；调用方（UI）负责随后重启内核。
 */
export async function pickSystemCore(): Promise<string | undefined> {
  const result = dialog.showOpenDialogSync({
    title: '选择内核可执行文件',
    filters: [
      {
        name: process.platform === 'win32' ? '可执行文件' : '所有文件',
        extensions: process.platform === 'win32' ? ['exe'] : ['*']
      }
    ],
    properties: ['openFile']
  })
  const source = result?.[0]
  if (!source) return undefined

  const dir = path.join(dataDir(), 'cores')
  mkdirSync(dir, { recursive: true })
  const target = path.join(dir, path.basename(source))

  await stopCore(true)
  const tmp = `${target}.tmp`
  copyFileSync(source, tmp)
  if (existsSync(target)) rmSync(target, { force: true })
  renameSync(tmp, target)
  await patchAppConfig({ core: 'system', systemCorePath: target })
  return target
}
