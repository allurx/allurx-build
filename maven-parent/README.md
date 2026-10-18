# Maven parent

`io.allurx:maven-parent` 为 Allurx Java 库提供共享构建配置。配置和当前模块版本见 [pom.xml](pom.xml)。

- 默认编译目标为 Java 25，使用 UTF-8 编码和固定插件版本；项目可覆盖 `maven.compiler.release` 和对应的 `*.version` 属性。
- 普通 `verify` 执行项目自己的构建和测试，不需要发布凭据。
- 构建时检查项目许可证，并将完整许可及已有声明随主 JAR、sources 和 Javadoc 交付。
- 显式启用 `release` profile 后，为 Java 模块附加 sources、Javadoc，并启用 GPG 签名和 Maven Central 发布插件。
- 父 POM 使用 `pom` packaging，只发布 POM、签名和校验文件。

## 使用

在项目 POM 中声明父 POM，将 `LATEST_VERSION` 替换为 [Maven Central 上已发布的版本](https://central.sonatype.com/artifact/io.allurx/maven-parent)：

```xml
<parent>
    <groupId>io.allurx</groupId>
    <artifactId>maven-parent</artifactId>
    <version>LATEST_VERSION</version>
    <relativePath/>
</parent>
```

项目自行声明业务依赖、模块、注解处理器和专属测试配置，并设置自己的项目坐标及 `name`、`description`、`url`、`scm`、`issueManagement`。发布签名和 Central 凭据由执行环境提供。

本模块不提供业务依赖 BOM。Spring Boot 应用可以直接继承 `spring-boot-starter-parent`；使用共享 CI 不要求继承此父 POM。Spring Boot 集成库也可以继承此父 POM，并自行导入 Spring Boot 的依赖 BOM。

## 许可证与资源

从 1.2.0 起，项目根目录需提供 `LICENSE.txt`，并保留 `.mvn/maven.config` 作为 Maven 原生根目录标记，见 [Java 模板](../templates/java-library/.mvn/maven.config)。模板中的文件留空，不添加命令行参数；复制工程时包含这个隐藏目录，使根目录、子模块目录及外部 `-f` 调用都使用同一根目录。缺少许可证时构建失败，不会静默生成缺少许可的制品。

默认从 `${maven.multiModuleProjectDirectory}` 读取 `LICENSE.txt`，以及存在的 `NOTICE.txt`、`THIRD-PARTY-NOTICES.txt`，不替项目生成或改写声明。模块确有独立许可目录时，可覆盖 `allurx.license.directory`，例如 `${project.basedir}`；目录应提供该模块所需的完整声明。文件按原始内容进入三类 JAR 的 `META-INF/`；可执行 JAR 的重打包布局由使用方插件决定。Javadoc 自带的 `legal/` 声明继续保留。

父 POM 使用 Maven 的 `maven-shared-archive-resources` 约定，让现有资源、sources 和 Javadoc 插件共同收录这些文件。默认的 `src/main/resources` 仍被包含。消费者若重新声明整个 `build.resources` 列表，须保留共享资源目录；只需附带 README 等额外文件时，优先使用资源插件在 `generate-resources` 阶段复制到 `${project.build.directory}/maven-shared-archive-resources`，不覆盖父资源列表。无 Java 源码模块的专有附件流程仍由项目维护。

## 本地验证

在本模块目录执行：

```sh
mvn -B -ntp clean verify
mvn -B -ntp -Prelease "-Dgpg.skip=true" clean verify
```

两条命令均不上传制品。第二条检查发布配置并跳过签名；Java 模块的编译、测试和附件仍须在实际使用方验证。测试未发布的父 POM 时，先将其安装到隔离的本地 Maven 仓库，再让使用方通过 `-Dmaven.repo.local` 使用同一仓库。

CI 与发布流程见仓库的[接入说明](../README.md)和[发布指南](../docs/release-guide.md)。本模块使用独立版本和 `maven-parent-vX.Y.Z` 发布 tag。

## 许可证

[Apache License 2.0](LICENSE.txt)。
