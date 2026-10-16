# Maven parent 维护

- 本模块只维护共享 Maven 构建配置；业务依赖、模块、注解处理器 和专属测试参数由使用方声明。
- XML 使用四空格缩进。插件版本通过属性和 `pluginManagement` 管理，不为仅管理版本的插件额外绑定目标。
- 签名与 Central 发布仅在显式 `release` profile 中启用，不增加全局测试跳过设置。
- 父 POM 使用 `pom` packaging，不生成占位 JAR，不设置会被 Java 模块继承的全局 sources/Javadoc 跳过选项。
- 修改继承配置时，对比受影响使用方的 effective POM，并验证实际 Java 模块的编译、测试和打包。父 POM 自身构建通过不能替代使用方验证。
- 发布使用本模块独立的 `maven-parent-vX.Y.Z` tag；工作流、发布权限和依赖更新约定由仓库根资料维护。
