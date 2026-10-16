# allurx-build 工作指引

本仓库维护共享配置、Actions、发布工具、Renovate preset 和模板。用途与维护命令见 [README](README.md)，各模块保留自己的约束。

## 职责与维护

- 源码注释与文档默认使用简体中文；需要声明文档时使用目标语言的标准多行形式（TypeScript 使用 JSDoc），实现内说明使用普通注释。版本标记、API、命令及已约定的检查名称保持原文。
- `maven-parent/` 维护 Maven 构建配置，`js-config/` 维护 JavaScript/TypeScript 工具配置；配置包不调用工作流，也不读取消费者的业务配置。
- `.github/workflows/` 维护验证、发布与部署，`actions/` 只放需要复用的动作，`src/` 是发布工具源码。`js-config/dist/`、`node_modules/` 和模板生成物不手工修改或提交。
- 业务依赖、模块、文件范围、框架约定和专有交付逻辑留在消费者；普通 CI 与制品发布分开，接入 CI 不强制采用本库 parent。
- 工作流与 preset、Maven parent、JS Config 分别使用各自 manifest 版本。改变公共入口时同步相关 README、[项目模板](templates/README.md)和消费者。
- 消费者固定真实发行 commit SHA、registry 包的精确版本及锁文件。尚未发布时只使用真实 tarball 或隔离 Maven 仓库验证，不伪造 registry metadata、integrity 或可解析的工作流 SHA。
- 依赖更新策略集中在 [default.json](default.json)。消费者的 CI 与分支保护遵循[接入说明](README.md#接入工作流)，全部必要验证仍须通过；基础配置和共享工作流更新须人工审核，站点合并后由实际生产分支的 CI 验证并部署。

## 验证与发布

- 修改共享配置或模板后，用实际打包产物在独立消费者中验证；父 POM 继承变化须验证相关 Java 消费者，Web 构建变化须保留产品所需的不同交付方式。
- 修改 workflow 时检查语法、调用路径、权限、事件及恢复分支。工作流测试替身和本地构建通过不能表述为远端发布成功。
- 发布命令会写入外部服务，不用于 smoke test。发布前核对已审阅 manifest、准确 commit、annotated tag 和所需 Environment；正式 tag 不移动或复用。
- Maven 上传前保存并验证原始 bundle 与签名；npm 上传前保存真实 tarball 及其身份。上传、公开核验和恢复均使用这些产物，不以重新构建或重新打包替代原发布证据。
- Maven 上传已进入或结果不明确时，保留 deployment ID，按[发布指南](docs/release-guide.md)查询和恢复，不重新上传。npm 同版本已存在时先核对原 tarball integrity，不能覆盖已有版本。
- 保留失败阶段、原始错误和已完成结果；artifact 名称、进程退出码或 registry 状态都不能单独证明完整发布成功。
