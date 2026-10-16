# Maven parent

`io.allurx:maven-parent` 为 Allurx Java 库提供共享构建配置。配置和当前模块版本见 [pom.xml](pom.xml)。

- 默认编译目标为 Java 25，使用 UTF-8 编码和固定插件版本；项目可覆盖 `maven.compiler.release` 和对应的 `*.version` 属性。
- 普通 `verify` 执行项目自己的构建和测试，不需要发布凭据。
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
