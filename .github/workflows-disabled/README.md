# 已禁用的上游 workflow

这些是从上游 fork 带过来的 workflow，触发条件在我们仓里不合适，移到这里（GitHub 只执行
`.github/workflows/*.yml`，所以放这里 = 不自动跑，需要时再移回去）。

- `rolling.yml`：上游的"滚动版"发布流程，**每次 push 到 master 都会跑全矩阵构建并发布一个
  名为 Rolling 的 prerelease**。我们用 stable 通道（版本号自增），不需要它。
  如果以后要做滚动版：移回 `.github/workflows/`，并把它的矩阵/发布目标按我们的需求改一遍。
- `aur.yml`：只有 `workflow_call` / `workflow_dispatch`，不会自动触发；它需要 AUR 私钥
  （`AUR_SSH_PRIVATE_KEY`），我们没有，所以保持禁用。
