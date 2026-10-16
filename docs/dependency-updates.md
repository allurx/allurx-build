# 常规依赖更新

Dependabot 负责按计划创建更新 PR；共享自动合并工作流在调用方的全部验证通过后，决定是否将 PR 合入 `dev`。Maven CI、依赖合并和正式发布是独立入口，正式发布仍按[发布指南](release-guide.md)执行。

## 接入

1. 将 [examples/dependabot.yml](../examples/dependabot.yml) 复制到调用方的 `.github/dependabot.yml`，并合入默认分支。示例每周检查 Maven 与 GitHub Actions，向 `dev` 创建 PR，将常规 minor、patch 更新分组。该配置必须保留在每个调用方仓库，不能通过共享工作流继承；仅推送到非默认分支不会激活配置。详见 [GitHub 配置说明](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)。
2. 按 [examples/ci.yml](../examples/ci.yml) 调用 `maven-ci.yml` 和 `dependabot-merge.yml`。后者的调用 job 必须用 `needs` 列出所有验收 job；普通项目使用 `needs: verify`，Kit 还须等待真实浏览器验证，使用 `needs: [verify, selenium]`。项目专有测试留在调用方，不传入通用命令或“验证通过”布尔值。
3. 在自动合并调用 job 显式声明 `contents: write` 和 `pull-requests: write`。共享工作流使用调用方的 `github` context 和 `GITHUB_TOKEN`，无需 `secrets: inherit` 或新增凭据。被调用方不能提升调用方授予的权限，见 [GitHub 复用工作流说明](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)。

保留原有验证 job 的标识，避免改变 required check 名称。验证失败、取消或未执行时，自动合并 job 不应运行。此入口直接在验证完成后执行 squash merge，不依赖仓库的原生 auto-merge 开关，也不替调用方修改分支保护。

## 自动合并范围

共享工作流只接受 `pull_request` 事件中由 `dependabot[bot]` 创建、来源与调用方仓库相同、目标为 `dev` 的 PR。每项更新都必须满足以下策略；分组中任意一项不满足，整组保留人工处理。

- 只处理 Maven 与 GitHub Actions，metadata 必须明确为 patch 或 minor，且更新前后主版本一致；`0.x` 只允许 patch。
- Actions 版本必须是三段数字，可带 `v` 前缀。Maven 接受至少两段的纯数字点分版本，例如 `1.37`、`25.0.1.1`；数字段不接受前导零。
- 仅 `com.google.guava:guava` 允许前后保持相同的 `-jre` 或 `-android` 变体，不允许增加、移除或切换变体。其他限定词、预发布、空版本或无法识别的 metadata 保留人工处理。
- `io.allurx:maven-parent` 和 `allurx/allurx-build` 的共享工作流、Action 更新保留人工核对。普通内部依赖不因 `io.allurx` 命名空间而排除，仍须通过版本策略和项目验证。

合并前再次读取实际目标分支，并用事件中的准确 head SHA 执行 `--match-head-commit`。更新后的 PR 必须重新验证，不能沿用旧 head 的结果。具体判断由[共享工作流](../.github/workflows/dependabot-merge.yml)维护，调用方不再复制脚本。

## 结果与失败处理

在调用方 **Actions → CI → Merge routine Dependabot updates** 查看 metadata、策略判断和合并结果。策略不允许时保留 PR 供人工审阅；验证或合并操作失败时保留失败结果，不跳过检查、重试到通过或增加无关权限。

多个 PR 同时修改同一 workflow 文件时，先合入的 PR 可能使后一个 PR 的最终合并内容不再与其分支中的文件一致。GitHub 此时可能报告缺少 `workflows` 权限。例外要求同路径、同内容已存在于同仓库另一分支，见 [GitHub 权限说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes)和 [CLI 维护者解释](https://github.com/cli/cli/issues/11493)。按项目约定将当前目标分支合入该 PR 分支，重新核对差异并等待完整 CI；不要仅重跑旧 head。Actions 分组减少同轮竞争，但不保证所有基线变化都无需刷新。

自动合并使用 `GITHUB_TOKEN`，由它产生的 push 不会再触发 push 工作流，见 [GitHub 事件触发说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)。因此自动合并只完成已验证的依赖更新进入 `dev`，不代表正式发布或 `main` 验证完成；后续发布集成、`main` push CI 和 tag 仍遵循发布流程。
