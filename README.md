# allurx-build

Allurx 项目的共享构建与发布工作流。当前支持 Maven CI、Maven Central 发布和失败恢复；公共 Maven 配置由独立的 `allurx/maven-parent` 维护。

| 工作流 | 用途 |
| --- | --- |
| [maven-ci.yml](.github/workflows/maven-ci.yml) | 使用 release profile 构建并验证业务工程，跳过签名，保存测试报告 |
| [maven-central-release.yml](.github/workflows/maven-central-release.yml) | 校验发布条件，发布到 Central，核验公开制品后创建 GitHub Release；支持恢复原部署 |

## 接入

适用于主分支为 `main` 的 GitHub.com 公开仓库，支持单模块和多模块 Maven 工程，packaging 为 `pom` 或 JPMS `jar`。

业务 POM 使用统一正式版本，并提供 `release` profile，配置 sources、Javadoc、GPG 签名和 `central-publishing-maven-plugin:0.11.0`（`extensions=true`、server ID 为 `central`）。保留默认聚合 bundle 路径，发布完整 reactor，不使用额外 classifier、发布排除或跳过配置。

在业务仓库建立 `maven-central` Environment：

- Secrets：`CENTRAL_USERNAME`、`CENTRAL_PASSWORD`、`GPG_PRIVATE_KEY`、`GPG_PASSPHRASE`。
- Variable：`GPG_FINGERPRINT`，填写完整主公钥指纹。
- 允许 `v*` tag 发布和 `main` 手动恢复。

将以下示例保存为业务仓库的 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`。文件名是发布门禁的一部分；两个 `<SHA>` 均替换为本仓库同一个已验证的完整 commit SHA。凭据由 Environment 提供，无需 `secrets: inherit`。

**`.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
    branches: [dev, main]
  push:
    branches: [dev, main]
  workflow_dispatch:
permissions:
  contents: read
  actions: read
concurrency:
  group: ci-${{ github.event_name }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    uses: allurx/allurx-build/.github/workflows/maven-ci.yml@<SHA>
```

**`.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: Original annotated version tag
        required: true
        type: string
      source-run-id:
        description: Original publish run ID
        required: true
        type: string
      source-run-attempt:
        description: Original publish attempt
        required: true
        type: string
      deployment-id:
        description: Original deployment UUID, if missing from evidence
        type: string
permissions:
  contents: read
concurrency:
  group: maven-central-release
  cancel-in-progress: false
  queue: max
jobs:
  release:
    permissions:
      contents: write
      actions: read
    uses: allurx/allurx-build/.github/workflows/maven-central-release.yml@<SHA>
    with:
      mode: ${{ github.event_name == 'workflow_dispatch' && 'recover' || 'publish' }}
      tag: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}
      source-run-id: ${{ inputs.source-run-id || '' }}
      source-run-attempt: ${{ inputs.source-run-attempt || '' }}
      deployment-id: ${{ inputs.deployment-id || '' }}
```

业务仓库还需配置 required CI checks 和正式 tag 防修改、防删除规则；保留上述发布并发组，避免同一仓库同时发布。

## 发布与恢复

1. 在发布 commit 中准备 `docs/releases/vX.Y.Z.md`，作为 GitHub Release 正文。
2. 合入 `main`，等待该 commit 的最新 main push CI 成功，再创建并推送 annotated tag `vX.Y.Z`。
3. 工作流先归档发布计划，再执行一次 `clean deploy`；Central 确认 `PUBLISHED` 后，独立核验公开文件、哈希和签名，最后创建或补全 GitHub Release。

失败后从 **main** 手动运行 Release，沿用原发布的共享工作流 SHA，填写原 tag、run ID 和 attempt；证据缺少 deployment ID 时补入原 ID。恢复复用原始 bundle，只查询同一部署，**不会重新构建、签名或 deploy**。不要通过重新推 tag 或反复重跑发布来代替恢复。

发布证据保留 90 天。原 bundle 丢失、证据过期、tag 移动或 Central 返回失败状态时，自动恢复停止，需要人工处理。

## 维护

辅助工具使用 TypeScript 实现，工作流会自动准备环境并编译。Node/npm 版本见 [package.json](package.json)，JDK LTS 和 Maven 版本见 [setup/action.yml](.github/actions/setup/action.yml)。本工程构建命令：

```sh
npm ci --ignore-scripts
npm run build
node dist/release.js --help
```

Dependabot 每周检查 npm 和 Actions；Node、JDK、Maven 的固定版本需单独维护。
