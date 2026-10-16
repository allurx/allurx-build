# 依赖更新

Renovate 负责发现版本更新、创建 PR，并在项目检查通过后合并符合策略的更新；共同策略由根 [default.json](../default.json) 维护。项目的验证、分支保护和发布流程仍由项目自己负责。

## 接入

1. 为目标仓库安装并授权 Renovate GitHub App，完成 onboarding。
2. 将 [Renovate 调用示例](../examples/renovate.json)复制为 `.github/renovate.json`，并纳入仓库默认分支。将 `extends` 固定到已发布的工作流版本；示例把更新 PR 发往 `dev`，直接在 `main` 开发时修改 `baseBranchPatterns`。共同策略由 preset 继承，项目只保留自己的目标分支和必要差异。

3. 在 GitHub 为目标分支设置完整 required checks，覆盖所有验收 job，例如 Java 的 Maven 与浏览器验证，或站点的完整 `site / verify`。
4. 在首次更新 PR 中核对目标分支、版本变更和完整检查，确认 Renovate 实际按共享策略运行。

共享策略使用 `platformAutomerge: false`，由 Renovate 自身在检查通过后执行合并，分支保护继续约束合并结果。配置文件、App 授权和实际检查缺一不可；行为说明见 [Renovate 自动合并文档](https://docs.renovatebot.com/key-concepts/automerge/)。

## 常规版本更新

常规 patch、minor 和 digest 更新在完整检查通过后可自动合并；`0.x` 的 minor 更新、基础配置包、父 POM 和本仓库工作流更新保留人工审核。关联包采用 `config:recommended` 提供的分组，其余更新保留独立 PR。具体匹配、时间和并发设置以 [default.json](../default.json) 为准。

npm 常规版本更新遵循 `security:minimumReleaseAgeNpm` 的发布年龄要求，达到预设观察期后再提出更新。该要求的范围与例外见 [Renovate npm 安全预设](https://docs.renovatebot.com/presets-security/#minimumreleaseagenpm)，不能把它当作对新依赖的安全审计。

Maven、npm、Actions 和 Node.js 的版本声明保留在工具原生文件中。项目直接使用的工具由项目声明，`@allurx/js-config` 的 peer 范围只表达兼容性；升级时同时核对运行时、类型声明、插件和锁文件。

## 漏洞告警与修复

GitHub [Dependabot alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts) 根据依赖图报告已知漏洞；Renovate 读取告警并提出修复 PR。仓库需启用依赖图和告警功能，并允许 Renovate App 读取 Dependabot alerts。常规版本更新仍由 `.github/renovate.json` 管理，这些告警设置是独立的 GitHub 功能。

安全修复 PR 使用独立的并发额度，最多同时 5 个，不占用常规更新的 5 个名额；它们保留人工确认，完整检查通过后再合并。安全告警的处理不受常规更新时间表限制，具体行为见 [Renovate 漏洞告警配置](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts)。

## 合并与后续验证

站点依赖 PR 合入生产分支后，由该分支的正常 push CI 重新验证并部署实际提交。以 `dev` 开发的项目仍需正常集成到发布分支；依赖更新本身不创建版本 tag 或发布制品。项目无需在 CI 中另写合并脚本，部署使用生产分支同次运行的产物。

检查失败、冲突或基础包升级需要兼容修改时，在 PR 中处理并重新验证准确 head。不要绕过 required checks、降低测试要求或把重新运行旧结果当作新版本验证。
