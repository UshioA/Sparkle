import { createHash } from 'crypto'
import { rm } from 'fs/promises'
import path from 'path'
import { getProfileConfig } from '../config'
import { mihomoProfileWorkDir, mihomoWorkDir } from '../utils/dirs'
import { accountProviderName } from './accountConfig'

/** 清掉账号 provider 的磁盘缓存，强制内核用新账号重新拉取节点列表。 */
export async function clearAccountProviderCache(): Promise<void> {
  const hash = createHash('md5').update(accountProviderName).digest('hex')
  const dirs = new Set<string>([mihomoWorkDir()])
  try {
    const { current } = await getProfileConfig()
    if (current) dirs.add(mihomoProfileWorkDir(current))
  } catch {
    // ignore
  }
  await Promise.all(
    [...dirs].map((dir) => rm(path.join(dir, 'proxies', hash), { force: true }).catch(() => {}))
  )
}
