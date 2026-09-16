# allurx-build

Allurx 项目的共享 Maven CI 与发布工作流，负责构建验证、发布到 Maven Central、核验公开制品和创建 GitHub Release。公共 Maven 配置由独立的 `allurx/maven-parent` 维护。

| 工作流 | 行为 |
| --- | --- |
| [maven-ci.yml](.github/workflows/maven-ci.yml) | 使用 `release` profile 执行 `clean verify`，跳过 GPG 签名，保存测试报告 |
| [maven-central-release.yml](.github/workflows/maven-central-release.yml) | 校验 tag、CI 和 Maven 模型，执行一次发布，核验公开制品后创建或补全 GitHub Release |

首次接入按下文配置；完整约束见 [Maven 接入契约](docs/maven-contract.md)，日常操作和故障处理见 [发布指南](docs/release-guide.md)。

## 适用范围

- GitHub.com 公开仓库，发布分支为 `main`，业务 POM 位于仓库根目录。
- 单模块或多模块 Maven 工程，发布整个 reactor；所有模块使用与 tag 对应的统一正式版本。
- packaging 仅支持 `pom` 和含 JPMS 描述符的 `jar`；JAR 模块必须提供实际 sources 和 Javadoc 内容。
- 正式 tag 使用 `vMAJOR.MINOR.PATCH`，例如 `v1.2.3`，并以 annotated tag 直接指向发布 commit。

当前接口不提供自定义 JDK、Maven、工作目录或 Maven 参数，也不支持 SNAPSHOT、预发布 tag、混合模块版本、局部 reactor 发布或额外 classifier。依赖、插件和父 POM 的版本也受[固定版本格式](docs/maven-contract.md#版本与-reactor)约束。

## 接入

### 1. 准备 Maven 工程

在业务 POM 中提供 `release` profile，配置 sources、Javadoc、GPG 签名和 `org.sonatype.central:central-publishing-maven-plugin:0.11.0`。Central 插件要求 `extensions=true`、server ID 为 `central`，并保留默认聚合 bundle 路径。

每个模块应具备完整的项目、许可证、开发者和 SCM 元数据；外部父 POM 必须可从 Maven Central 获取。具体插件限制、制品内容和校验方式见 [Maven 接入契约](docs/maven-contract.md)。

### 2. 配置发布身份

先准备有目标 namespace 发布权限的 Central Portal 账号及 User Token，并按 Sonatype 的要求分发签名公钥。参见 [Portal Token](https://central.sonatype.org/publish/generate-portal-token/) 和 [GPG 公钥分发](https://central.sonatype.org/publish/requirements/gpg/#distributing-your-public-key)。

在**业务仓库**创建名为 `maven-central` 的 Environment，配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `CENTRAL_USERNAME` | Central Portal User Token 的 username |
| Secret | `CENTRAL_PASSWORD` | 同一 User Token 的 password |
| Secret | `GPG_PRIVATE_KEY` | 可用于签名的 ASCII-armored GPG 私钥文本 |
| Secret | `GPG_PASSPHRASE` | 私钥口令 |
| Variable | `GPG_FINGERPRINT` | 完整主公钥指纹，40 或 64 位十六进制字符；不要填写短 key ID 或子密钥指纹 |

Central 凭据使用 User Token 的两部分，配置规则见 [Sonatype Maven 凭据说明](https://central.sonatype.org/publish/publish-portal-maven/#credentials)。工作流会生成 server ID 为 `central` 的 Maven settings，并通过环境变量向签名插件提供口令。

Environment 的部署规则需允许 `v*` **tag**；需要人工审批时在该 Environment 配置 reviewer。发布只由 tag push 触发，不提供手动发布入口。

默认接入方式无需 `secrets: inherit`：发布 job 已绑定 `maven-central`，读取业务仓库的 Environment Secrets。不会读取 `allurx-build` 仓库的 Secrets；个人账号下各仓库的 Environment 需要分别配置。参见 [可复用工作流的凭据规则](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow)。

共享工作流和业务仓库属于同一组织时，也可将四个 Secrets 和 `GPG_FINGERPRINT` 变量集中配置在组织级，授权给业务仓库，并在业务仓库的 `jobs.release` 下添加 `secrets: inherit`。各仓库仍保留 `maven-central` Environment 的部署规则；同名 Environment Secret 会优先于继承的 Secret。参见[组织级 Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-an-organization) 和[调用方变量作用域](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#configuration-variable-precedence)。

### 3. 安装调用工作流

复制以下文件到**业务仓库**，并将两个 `<SHA>` 替换为 `allurx/allurx-build` 同一个已验证的 **40 位 commit SHA**：

| 本仓库示例 | 业务仓库目标路径 | 触发方式 |
| --- | --- | --- |
| [examples/ci.yml](examples/ci.yml) | `.github/workflows/ci.yml` | 面向 `dev`、`main` 的 PR，两个分支的 push，以及手动运行 |
| [examples/release.yml](examples/release.yml) | `.github/workflows/release.yml` | `v*` tag push 发布 |

这里固定的是**共享工具仓库的 SHA**；正式 tag 指向的是**业务仓库的发布 commit**。升级共享工作流时同步更新两个引用，并通过业务 CI 验证。

从旧版升级时，还需按当前 [release.yml 示例](examples/release.yml) 更新调用结构，移除除 `tag` 外的旧 inputs 和手动触发配置；仅替换 SHA 会留下无效的调用参数。

保留以下调用约定：

- 文件名 `ci.yml`、`release.yml` 和发布分支 `main` 是工具查询 CI 和重复发布历史的依据，不能只在调用方单独改名。
- CI 需要 `contents: read`、`actions: read`；发布调用 job 需要 `contents: write`、`actions: read`。写权限用于创建 GitHub Release 及上传附件，Central 发布 job 内部仅保留读权限。
- 保留发布并发组 `maven-central-release`、`cancel-in-progress: false` 和 `queue: max`，让同一业务仓库的发布串行等待。`queue: max` 最多容纳 100 个待运行任务，详见 [GitHub 并发规则](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)。
- 为发布分支配置 required CI checks，并为正式 tag 配置防修改、防删除规则。这些仓库设置需要自行完成，工作流不会创建它们。

示例已给出完整 YAML，无需在 README 中拼接配置。没有 `dev` 分支时可以移除对应触发项，保留 `main` 的 push CI。

## 工作流接口

`maven-ci.yml` 没有自定义 inputs、secrets 或 outputs。它使用提交时间设置 `project.build.outputTimestamp`，不接收发布凭据；Surefire/Failsafe 报告存在时上传为 `maven-reports-<run_id>-<run_attempt>`，保留 14 天。CI 不执行签名、Central 上传或公开制品核验。

`maven-central-release.yml` 只接受一个字符串 input；[发布示例](examples/release.yml) 已根据事件填写：

| Input | 默认值 | 用途 |
| --- | --- | --- |
| `tag` | 空字符串 | 从 tag push 事件读取；显式提供时必须与事件 tag 一致 |

工作流提供 `version`（不含 `v`）、`commit`（业务发布 commit SHA）和 `release-url`（GitHub Release URL）三个 outputs。`version`、`commit` 来自准备阶段，不能单独证明发布成功；完整发布结果应结合工作流结论和[公开校验报告](docs/release-guide.md#发布证据)判断。

## 发布

1. 将正式版本和经审阅的 `docs/releases/vX.Y.Z.md` 一起合入业务仓库 `main`。
2. 等待发布 commit 对应的最新 `main push CI` attempt 成功，再创建并推送 annotated tag `vX.Y.Z`。
3. 工作流归档发布计划后执行一次 `clean deploy`；确认 Central 为 `PUBLISHED`，再独立核验公开文件、哈希和签名，最后创建或补全 GitHub Release。

如果部署已经进入或无法排除已进入，工具会阻止再次发布。此时保留证据，人工核查 Central 原部署及公开制品；不能把失败退出码当作未上传的证明。

发布证据配置保留 90 天。允许重跑的前置条件、操作示例、Central 状态和错误处理见 [发布指南](docs/release-guide.md)。

## 维护

辅助工具使用 TypeScript 实现；[setup/action.yml](.github/actions/setup/action.yml) 安装工具链并编译 CLI。当前固定版本如下，后续变动以配置文件为准：

| 工具 | 当前配置 | 定义位置 |
| --- | --- | --- |
| Runner | `ubuntu-24.04` | [共享 CI](.github/workflows/maven-ci.yml)、[发布工作流](.github/workflows/maven-central-release.yml) |
| Node.js | `26.8.2`；本地 engines 为 `>=26.8.2 <27` | [setup action](.github/actions/setup/action.yml)、[package.json](package.json) |
| npm | `12.0.2` | [package.json](package.json) |
| JDK | Temurin `25.0.4.1+1` | [setup action](.github/actions/setup/action.yml) |
| Maven | `3.9.16`，下载后验证 SHA-512 | [setup action](.github/actions/setup/action.yml) |

本地使用符合 `package.json` 的 Node/npm，在本仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run build
node dist/release.js --help
```

这些命令验证类型、编译和 CLI 帮助入口，不需要 Central 或 GPG 凭据。CI 和发布 job 准备 JDK/Maven；公开核验 job 只安装 Node/npm、编译辅助 CLI，不安装业务构建工具链。

| 源文件 | 职责 |
| --- | --- |
| [src/release.ts](src/release.ts) | `prepare`、`deploy`、`finish` 阶段及证据流转 |
| [src/github.ts](src/github.ts) | tag、精确 commit CI、重复发布、Actions artifact 和 GitHub API |
| [src/artifacts.ts](src/artifacts.ts) | effective POM、bundle、JAR、哈希、签名和公开制品校验 |
| [src/util.ts](src/util.ts) | 子进程、日志脱敏、文件、HTTP 和工作流输出 |

本仓库 [CI](.github/workflows/ci.yml) 通过 setup action 安装依赖并编译 CLI，目前没有自动化测试套件，也不执行真实 Central 发布。修改工作流或发布逻辑后，仍需在业务仓库验证相应 GitHub Actions 行为。

[Dependabot](.github/dependabot.yml) 每周检查 npm 和 Actions。Node、JDK、Maven、CLI 中固定的 Maven 插件及 GitHub API 版本需单独维护；升级时同步检查示例、文档和调用接口兼容性。同一次发布的各阶段必须使用计划中记录的共享工作流 SHA。
