import yaml from 'yaml'
import { REPO_SLUG } from '../src/shared/repo.ts'
import { readFileSync, writeFileSync } from 'fs'

const pkg = readFileSync('package.json', 'utf-8')
let changelog = readFileSync('changelog.md', 'utf-8')
const { version } = JSON.parse(pkg)
const tag = process.env.RELEASE_TAG || version
const downloadUrl = `https://github.com/${REPO_SLUG}/releases/download/${tag}`
const latest = {
  version,
  tag,
  changelog
}

if (process.env.SKIP_CHANGELOG !== '1') {
  // 只列本仓 build 矩阵真实产出的资产，避免出现 404 链接
  changelog += '\n### 下载地址：\n\n#### Windows10/11：\n\n'
  changelog += `- 安装版：[64 位](${downloadUrl}/sparkle-windows-${version}-x64-setup.exe)\n\n`
  changelog += `- 便携版：[64 位](${downloadUrl}/sparkle-windows-${version}-x64-portable.7z)\n\n`
  changelog += '#### macOS 11+:\n\n'
  changelog += `- PKG：[Intel](${downloadUrl}/sparkle-macos-${version}-x64.pkg) | [Apple Silicon](${downloadUrl}/sparkle-macos-${version}-arm64.pkg)\n\n`
  changelog += '#### Linux:\n\n'
  changelog += `- DEB：[64 位](${downloadUrl}/sparkle-linux-${version}-amd64.deb)\n\n`
  changelog += `- tar.gz：[64 位](${downloadUrl}/sparkle-linux-${version}-x64.tar.gz)`
}
writeFileSync('latest.yml', yaml.stringify(latest))
writeFileSync('changelog.md', changelog)
