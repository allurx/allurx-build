# 项目模板

模板用于建立独立工程。复制后由项目维护业务代码、运行环境、命令和交付方式；共享配置或工作流的更新通过明确版本进入项目，不自动覆盖已复制文件。

| 模板                                                 | 适用场景                        | 构建基础                                      |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| [Java library](java-library/README.md)               | 发布到 Maven Central 的 Java 库 | `io.allurx:maven-parent`                      |
| [Spring Boot service](spring-boot-service/README.md) | Spring Boot 应用与服务          | 官方 `spring-boot-starter-parent`             |
| [Node tool](node-tool/README.md)                     | 命令行工具和 Node.js 程序       | `@allurx/js-config` 与项目自己的 Node.js 工具 |
| [Static site](static-site/README.md)                 | HTML、TypeScript、Vite 静态网站 | `@allurx/js-config` 与项目自己的工具版本      |

选择模板后先修改项目坐标、名称和必需元数据，再安装依赖、执行其 README 中的本地验证。正式依赖必须对应 registry 中已发布的版本；测试未发布基础包时使用真实 tarball 或隔离 Maven 仓库，不把临时文件路径带入交付配置。

CI 与发布按项目实际需要接入[共享工作流](../README.md#接入工作流)。从正式工作流发行取得其指向的 40 位 commit SHA，再替换模板或调用示例中的 `WORKFLOWS_COMMIT_SHA`；未替换的占位符不能运行。静态站点模板同时提供验证与部署入口，还需设置自己的部署目标。

依赖更新使用[版本化 Renovate preset](../docs/dependency-updates.md)。新项目先建立有意义的完整检查，再启用适用的自动合并；启用后核对服务器端保护、机器人目标分支和所需发布配置的实际状态。
