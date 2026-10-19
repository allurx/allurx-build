# 项目模板

模板用于建立独立工程。复制后由项目维护业务代码、运行环境、命令和交付方式；共享配置或工作流的更新通过明确版本进入项目，不自动覆盖已复制文件。

| 模板                                                 | 适用场景                        | 构建基础                                      |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| [Java library](java-library/README.md)               | 发布到 Maven Central 的 Java 库 | `io.allurx:maven-parent`                      |
| [Spring Boot service](spring-boot-service/README.md) | Spring Boot 应用与服务          | 官方 `spring-boot-starter-parent`             |
| [Node tool](node-tool/README.md)                     | 命令行工具和 Node.js 程序       | `@allurx/js-config` 与项目自己的 Node.js 工具 |
| [Static site](static-site/README.md)                 | HTML、TypeScript、Vite 静态网站 | `@allurx/js-config` 与项目自己的工具版本      |

选择模板后先修改项目坐标、名称和必需元数据，再安装依赖、执行其 README 中的本地验证。正式依赖必须对应 registry 中已发布的版本；测试未发布基础包时使用真实 tarball 或隔离 Maven 仓库，不把临时文件路径带入交付配置。

CI 与发布按项目实际需要接入[共享工作流](../README.md#接入工作流)。完整调用示例和静态站点模板已固定正式工作流 `workflows-v2.0.0` 的完整 commit SHA，复制后配置项目分支、发布条件和部署目标即可。选择其他发行时，再按接入说明更新 SHA 与版本注释。

依赖更新使用[版本化 Renovate preset](../docs/dependency-updates.md)。新项目先建立有意义的完整检查，再启用适用的自动合并；启用后核对服务器端保护、机器人目标分支和所需发布配置的实际状态。

## 许可证约定

模板统一采用 Apache-2.0，根 `LICENSE.txt` 保留完整英文正文。自有源码使用准确的版权行和 `SPDX-License-Identifier: Apache-2.0`，以对应语言的注释语法书写；这是 [Apache 官方支持的简短文件头](https://www.apache.org/foundation/license-faq.html#Apply-My-Software)。复制模板时保留已有归属，新增内容按实际权利人及年份声明。JSON 和二进制资源不强加注释，第三方声明按原许可保留，不统一改写为项目许可。

构建产物应随实际分发方式提供完整许可证；静态站点模板通过共享 Vite 插件从根文件生成交付副本，不维护第二份正文。源码的 SPDX 标识不能代替分发所需的完整许可和第三方声明。
