# 发布与恢复

本仓库的组件统一由 [release.yml](../.github/workflows/release.yml) 的 `workflow_dispatch` 发布。版本先在源码 manifest 中审阅；普通发布通过 `verify` job 复用完整 [ci.yml](../.github/workflows/ci.yml)，全部门禁通过后才创建 annotated tag 并发布对应制品。

## 首次准备

按[接入说明](../README.md#接入工作流)核对既有分支保护和完整 CI，并为正式 tag 配置防修改、防删除保护。发布只从已审阅的默认分支提交发起；配置包、parent 和工作流分别发布，不自动级联升级消费者。

Maven 发布使用调用方的 `maven-central` Environment。按需要设置分支/tag限制与审批，并配置以下值：

| 类型     | 名称               | 内容                                  |
| -------- | ------------------ | ------------------------------------- |
| Secret   | `CENTRAL_USERNAME` | Central Portal User Token 的 username |
| Secret   | `CENTRAL_PASSWORD` | 同一 User Token 的 password           |
| Secret   | `GPG_PRIVATE_KEY`  | ASCII-armored GPG 私钥                |
| Secret   | `GPG_PASSPHRASE`   | 私钥口令                              |
| Variable | `GPG_FINGERPRINT`  | 完整主公钥指纹                        |

Token 需有目标 namespace 的发布权限；签名公钥需按 Central 要求可获取。令牌和签名配置参考 [Sonatype 发布说明](https://central.sonatype.org/publish/publish-portal-maven/)，不要把凭据写入 POM、源码或命令行参数。

npm 发布使用 `npm` Environment 与 OIDC。首次创建包时，由有权且已登录的 npm 账号发布**经过验证的真实 tarball**；包建立后，在 npm 的 Trusted Publisher 中配置 GitHub 用户 `allurx`、仓库 `allurx-build`、最初调用工作流文件名 `release.yml`、Environment `npm`，并允许直接 `npm publish`。不要把被调用的 `npm-publish.yml` 当作最初的发布入口。其他工程复用此工作流时，登记该工程自己的仓库、最初调用入口和 Environment。发布 job 需要 `id-token: write`，无需长期 npm 写入令牌。具体权限和配置步骤见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 发布本仓库组件

1. 修改相应 manifest 的稳定版本，完成本地验证、审阅与默认分支集成；核对发布提交及其完整 CI。
2. 在 **Actions → Release build infrastructure → Run workflow** 选择默认分支和 `component`，普通发布保留全部恢复参数为空。
3. 等待发版前 CI 完成：Linux、Windows 的 Node 与配置包验证、Maven parent 验证、Java 消费者模板验证均须通过 `CI required`。随后工作流读取版本并生成下表 tag。已有 tag 只允许同一 run 恢复使用，并核对 annotated tag、提交和记录的 run 身份；另一次 run 需使用相应恢复入口。完成 Environment 审批后，查看对应发布 job 和公开验证结果。

| component      | 版本来源                                            | tag                   |
| -------------- | --------------------------------------------------- | --------------------- |
| `workflows`    | 根 [package.json](../package.json)                  | `vX.Y.Z`              |
| `maven-parent` | [maven-parent/pom.xml](../maven-parent/pom.xml)     | `maven-parent-vX.Y.Z` |
| `js-config`    | [js-config/package.json](../js-config/package.json) | `js-config-vX.Y.Z`    |

单一产品仓库的 GitHub Release 标题使用 `vX.Y.Z`。本仓库的组件独立发版，标题使用 `workflows vX.Y.Z`、`maven-parent vX.Y.Z`，避免把不同组件误认为同一条版本线；tag 仍按上表区分组件。已发布 tag 保持不变，标题整理不改变版本、关联提交或制品。

工作流组件创建 GitHub Release；Maven parent 发布到 Central 并附上公开核验结果；JS Config 发布到标准 npm registry 并核对 registry 公布的 tarball integrity。消费者随后按自己的流程升级 parent/package 版本、锁文件或工作流完整 SHA，不能将本仓库发布成功表述为消费者已完成升级。

## 调用方发布 Maven 制品

独立项目保留自己的 Release 触发和分支流程，调用 `maven-central-publish.yml`。先满足 [Maven 契约](maven-contract.md)，按[工作流接入步骤](../README.md#接入工作流)取得正式发行的 40 位 SHA，并替换下方占位符：

```yaml
jobs:
    publish:
        uses: allurx/allurx-build/.github/workflows/maven-central-publish.yml@WORKFLOWS_COMMIT_SHA
        permissions:
            contents: write
            actions: read
        secrets: inherit
        with:
            tag: ${{ github.ref_name }}
```

完整的 [Maven 发布调用示例](../examples/release.yml)包含 tag 推送发布和手动查询恢复；手动入口须填写原 tag、run ID 和 deployment ID。`working-directory`、`java-version` 和 `tag-prefix` 用于实际存在的项目差异。调用方自己核对发布分支、提交、测试与版本，发布工作流不替它合并分支或发布其他工程。

## 调用方发布 npm 包

`npm-publish.yml` 面向标准 npm registry 的公开包。调用方仓库根目录提供 `.node-version`、锁文件和完整的 `npm run verify`，构建验证无需发布凭据。包的名称、版本、公开文件和 registry 元数据由其 `package.json` 维护。

单包工程使用 `workspace: .`；npm workspaces 工程填写要发布的 workspace 目录。下面的 job 对应 annotated `vX.Y.Z` tag 触发，完整 SHA 的获取方式见[接入步骤](../README.md#接入工作流)：

```yaml
jobs:
    publish:
        uses: allurx/allurx-build/.github/workflows/npm-publish.yml@WORKFLOWS_COMMIT_SHA
        permissions:
            contents: read
            actions: read
            id-token: write
        with:
            tag: ${{ github.ref_name }}
            workspace: .
            tag-prefix: v
```

先按[首次准备](#首次准备)登记调用方自己的 Trusted Publisher 和 `npm` Environment。工作流构建并保留实际 tarball，再由 OIDC 发布任务消费；恢复使用原 Actions run，不另建重新打包的发布入口。

## 产物与成功条件

Maven 流程使用 `skipUpload` 构建签名 bundle，检查并保存 `bundle.zip`、manifest 和公钥后，只上传保存的原文件。上传返回的 deployment ID 进入状态记录；Central 为 `PUBLISHED` 后，再逐项核对公开文件的大小与 SHA-256，最后创建 GitHub Release 草稿，核对公开附件完整后发布。相关产物保存在 `maven-bundle-<run_id>` 与 `maven-publication-<run_id>-<attempt>` 中。

npm 流程保存一次打包得到的 tarball 及身份记录，按 workspace 区分产物，发布 job 下载准确 artifact ID。记录绑定仓库、tag、commit、workspace 和原 tarball 的 SHA-512；使用者无需计算内部 artifact 名称。上传和核验使用同一 tarball；registry 中已有相同版本时，只有 integrity 与原文件一致才继续，否则失败，不覆盖已有版本。

Artifacts 的保留期以工作流配置为准。应保存恢复所需的原运行 ID、tag、commit 和 deployment ID，并在 artifact 过期前处理失败。构建成功、上传响应、registry 状态或 GitHub Release 单独存在，都不能代替所需公开核验。

## Maven 失败恢复

首次构建、签名、归档或上传前的准备失败时，可在原 Actions run 重新运行失败 job 或全部 job。工作流通过 GitHub 的 attempt 记录确认先前发布 job 或实际上传步骤均未进入；只有得到明确证据后，才允许生成尚未保存的 bundle 并进行首次上传。已经保存的 bundle 始终复用，不因重跑而重新签名或构建。

上传步骤一旦开始，失败或超时也可能已经到达 Central。先从原运行的 `publication.json`、日志和 Central Portal 核对 deployment ID，再使用以下查询恢复入口；不通过重新上传判断先前上传是否成功。

在本仓库重新派发 `release.yml`，选择 `component=maven-parent`，同时填写：

| 输入              | 值                                   |
| ----------------- | ------------------------------------ |
| `recovery-tag`    | 原 annotated tag，不创建或移动新 tag |
| `recovery-run-id` | 保存原 bundle 的 Actions run ID      |
| `deployment-id`   | 对应的 Central deployment UUID       |

Maven 恢复使用原产物，跳过新发布所需的源码 CI、制品重建和 tag 创建；下载原 bundle 后仍核对原 run、仓库、tag、commit 与记录的共享工作流身份，只查询原部署并继续公开核验。独立消费者的手动恢复入口向共享工作流传入原 `tag`、`recovery-run-id` 和 `deployment-id`，不得伪装成新的 tag 发布。

上传已进入或无法排除上传时，若 deployment ID 或原 bundle 缺失，先人工核查已完成阶段，不用重新构建替代原证据。Central 已发布但后续核验失败时，保留原部署。GitHub Release 收尾中断时可重跑对应 job；流程核对身份和已有附件，只补齐相符的缺失附件并发布草稿，保留已编辑正文。身份或附件冲突时停止，不覆盖既有内容，也不再次上传 Central。

## npm 失败恢复

在原 Actions run 重新运行失败 job 或全部 job。已有该 workspace 的 tarball 时，工作流复用准确 artifact ID，并核对原文件 integrity；registry 中同版本与原文件一致则继续验证，不一致则停止调查。

首次构建或归档失败、尚未保存 tarball 时，只有 GitHub 记录能明确证明此前未进入该 workspace 的发布步骤，工作流才允许重新执行首次构建和打包。这一路径保留原 run、tag 和 commit 身份。

发布已进入或结果不明，而原 tarball artifact 缺失或过期时，停止重建并核对 registry 与原日志。恢复必须使用原产物，不能重新打包冒充原发布文件，也不通过新 run 或删除已发布版本绕过检查。
