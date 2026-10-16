# allurx-build

Allurx 项目的共享构建配置、GitHub Actions、依赖更新策略和起步模板。项目按需要选择入口；使用共享 CI 不要求同时采用父 POM、配置包或某种部署方式。

| 需要完成的工作                                 | 接入入口                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 统一 Java 库的编译、测试和发布配置             | [Maven parent](maven-parent/README.md)，通过 Maven Central 的 `io.allurx:maven-parent` 使用                                                                         |
| 复用 ESLint、Prettier、TypeScript 或 Vite 配置 | [JS Config](js-config/README.md)，通过 npm registry 的 `@allurx/js-config` 使用                                                                                     |
| 验证 Maven 工程                                | [maven-ci.yml](.github/workflows/maven-ci.yml)，执行项目的 `clean verify`                                                                                           |
| 验证 Node.js 工程                              | [Node 接入说明](docs/node.md)与 [node-ci.yml](.github/workflows/node-ci.yml)                                                                                        |
| 发布 Maven 或 npm 制品                         | [maven-central-publish.yml](.github/workflows/maven-central-publish.yml)、[npm-publish.yml](.github/workflows/npm-publish.yml)，见[发布指南](docs/release-guide.md) |
| 部署 Cloudflare 静态站点                       | [cloudflare-static-site.yml](.github/workflows/cloudflare-static-site.yml)，见[部署说明](docs/cloudflare-static-site.md)                                            |
| 定期更新依赖                                   | 根 [Renovate preset](default.json)，见[依赖更新指南](docs/dependency-updates.md)                                                                                    |
| 新建工程                                       | [项目模板](templates/README.md)                                                                                                                                     |

业务依赖、模块、源码范围、产品构建和部署目标仍由项目维护。Spring Boot 应用可以保留官方 parent，只接入共享 Maven CI；纯 Node.js 工程可以只使用检查配置，不安装 Vite 或 Wrangler。

## 接入工作流

共享工作流以 GitHub.com 为运行目标。Maven 和 npm 入口使用 GitHub.com 的 [workflow identity 上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#job-context)固定辅助工具来源，GitHub Enterprise Server 不在支持范围。

完整的 [Maven CI 示例](examples/ci.yml)、[Maven 发布示例](examples/release.yml)和[静态站点模板](templates/static-site/README.md)已固定到正式 [v1.0.0](https://github.com/allurx/allurx-build/releases/tag/v1.0.0) 的完整 commit SHA。复制时无需重新查找 SHA，按项目配置分支、发布条件和部署目标即可。

文档中的简短片段使用 `WORKFLOWS_COMMIT_SHA` 表示工作流版本。自行编写调用方或选择其他发行时：

1. 在 [Releases](https://github.com/allurx/allurx-build/releases) 选择包含所需工作流的正式 `vX.Y.Z` 发行。
2. 将下方 `WORKFLOW_TAG` 换成所选 tag，取得其指向的完整 40 位 commit SHA：

    ```sh
    gh api repos/allurx/allurx-build/commits/WORKFLOW_TAG --jq .sha
    ```

3. 将输出的 SHA 填入文档片段中的 `WORKFLOWS_COMMIT_SHA`，或替换已复制文件的 `uses` SHA，并在同行注释记录对应 tag。占位符不是可运行引用。

Maven 共享验证入口示意：

```yaml
jobs:
    verify:
        uses: allurx/allurx-build/.github/workflows/maven-ci.yml@WORKFLOWS_COMMIT_SHA
```

调用方定义触发事件、权限和并发策略，项目专有检查保留为自己的 job。采用 PR 保护的发布分支应将全部必要验证配置为 required checks，包括额外的集成或浏览器检查。直接推送流程和开发分支沿用既有规则；接入共享 CI 不要求强制 PR 或新增绕过规则。所有必要 CI 仍须通过。

配置包版本、父 POM 版本和工作流版本独立演进。安装包时选择 registry 中确实已发布的精确版本，工作流升级通过修改 SHA 进入审阅；不使用分支名承担可重复安装或发布的版本标识。

## 本地维护

Node.js 版本以 [.node-version](.node-version) 为准，根目录通过 npm workspaces 管理 [js-config](js-config/package.json)。Maven 分发版本与校验在 [setup-maven](actions/setup-maven/action.yml) 中维护，Java 构建要求见[父 POM](maven-parent/pom.xml)。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run verify
bash scripts/verify-maven-parent.sh
```

发布工具源码和测试由 Node.js 直接运行 TypeScript；根 `build` 只构建 JS Config。配置包独立清理和生成 JavaScript、类型声明，`prepack` 也会先执行该构建流程。Node 验证包含发布工具检查和配置包的真实 tarball 消费测试。

签名测试需要可执行的 `gpg` 与 `gpgconf`。Windows 需使用原生 GnuPG，并确保其 `bin` 目录位于 Git/MSYS 的目录之前。上传保护的 Bash 集成测试在 Linux CI 必须执行；Windows 本地通过 `ALLURX_TEST_BASH` 指定 Git Bash，并在 `PATH` 中提供 `jq`；未指定 Bash 时该项会标记为跳过。Java 验证脚本使用 Bash，将候选 parent 安装到隔离 Maven 仓库，并验证 Java 库和 Spring Boot 服务模板；实际产品仍需自己的编译、JPMS、测试和附件验证。完整 CI 入口见 [ci.yml](.github/workflows/ci.yml)。

发布本仓库组件统一从 **Actions → Release build infrastructure** 选择组件，发版前复用同一套完整 CI，通过后才读取已审阅 manifest 的版本并创建 tag。流程和失败恢复见[发布指南](docs/release-guide.md)。本地检查不验证 GitHub Environment、npm Trusted Publisher、Central 凭据或线上部署状态。

## 许可证

[Apache-2.0](LICENSE.txt)。
