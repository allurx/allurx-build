# Maven 接入契约

工作流从调用方根 POM 处理完整 reactor，并校验以下约束。

## 版本与模型

- tag 为 `vMAJOR.MINOR.PATCH`，各段除 `0` 外不以零开头，不接受后缀。所有模块版本等于去掉 `v` 的 tag 版本，坐标不得重复；模型与 bundle 均校验此规则。
- 仅支持 `pom`、`jar` packaging，不支持 `test-jar`；须构建完整 reactor，不得使用 `-N`、`-pl` 或从构建中排除模块。
- effective POM 中第三方依赖、父 POM、插件及管理配置的 `version` 须非空、无空白、已解析且固定。拒绝 `LATEST`、单独的 `RELEASE`、版本范围、通配符、未解析变量、`SNAPSHOT` 和 Maven 时间戳快照。检查排除 `profiles`、`properties` 子树，但包含激活 profile 后进入生效模型的配置。
- 第三方固定版本不限制后缀，是否采用预发布依赖由调用方决定；父 POM 下载坐标仍须通过路径安全检查。

## release profile

调用方配置编译、测试、sources、Javadoc 和 GPG 签名。各模块的 effective POM 须包含：

```xml
<plugin>
  <groupId>org.sonatype.central</groupId>
  <artifactId>central-publishing-maven-plugin</artifactId>
  <version>0.11.0</version>
  <extensions>true</extensions>
  <configuration>
    <publishingServerId>central</publishingServerId>
  </configuration>
</plugin>
```

仅保留扩展注入的一个 `injected-central-publishing` execution，绑定 `deploy` 阶段的 `publish` goal。工作流传入 `autoPublish=true`、`waitUntil=published`、`gpg.bestPractices=true`、签名指纹、deployment name 和提交时间戳。

| 配置 | 允许值或限制 |
| --- | --- |
| Central 地址 / server ID | `https://central.sonatype.com` / `central` |
| bundle | 默认 `target/central-publishing/central-bundle.zip`，可在根项目或子模块中；整个 reactor 仅一个 |
| staging / deferred 目录 | 默认配置 |
| `autoPublish` / `waitUntil` / `deploymentName` | 不覆盖工作流提供的值 |
| `checksums` | 默认值、`all` 或 `required` |
| `waitMaxTime` / `waitPollingInterval` | 显式设置时分别为 1800–7200 秒 / 5–60 秒 |
| `waitForPublishCompletion` / `publishCompletionPollInterval` | 禁止使用 |

所有模块仍须构建并测试；`maven.deploy.skip` 不作为 Central 排除信号。仅通过 Central 原生 `skipPublishing=true` 将示例等非发布模块排除。该值可来自 effective POM 的属性或 Central 插件、execution 配置，须已解析为布尔值，且各处不能冲突。排除不允许跳过测试，也不允许发布模块的父 POM 或依赖引用被排除的 reactor 坐标。整个 reactor 至少包含一个发布模块。

sources、Javadoc、签名及测试的跳过开关仍禁止；`ignorePublishedComponents`、`excludeArtifacts`、`attach=false`、`failOnBuildFailure=false` 也不允许。classifier 仅允许标准 `sources`、`javadoc`；无源码模块可由 `maven-jar-plugin` 的独立附加 `jar` execution 生成这两个标准说明归档；插件全局配置与 `default-jar` execution 的 classifier 必须为空，保留主 JAR。

工作流生成 server ID 为 `central` 的 Maven settings，导入私钥，并通过 `MAVEN_GPG_PASSPHRASE` 向 GPG 传入口令。普通 CI 使用 `gpg.skip=true`，正式发布非交互签名。

### 注意事项

- 上述 XML 片段不是完整 profile。
- 插件配置按白名单校验，不接受其全部合法选项。
- 发布 job 上限为 60 分钟。

## 元数据与制品

各模块的 effective POM 须有非空、已解析的 `name`、`description`、`url`，完整 SCM（`url`、`connection`、`developerConnection`），至少一个 license（每项含 name/url）和 developer（每项含 name 或 id）。公开 POM 沿父链核验元数据；外部父 POM 须可从 Maven Central 下载，父链不得循环或过深。

| packaging | 必须发布的主体 |
| --- | --- |
| `pom` | `<artifactId>-<version>.pom` |
| `jar` | POM、主 JAR、`-sources.jar`、`-javadoc.jar` |

每个主体须有 `.asc`、`.md5`、`.sha1`，可另含 `.sha256`、`.sha512` 和签名文件校验和。文件集合须与发布模型完全一致，不得缺失、为空或多出制品，包括不得混入被排除模块。Model/Manifest 使用 schemaVersion 2，分别保存发布模块与 `excludedModules` 坐标；计划和公开报告均保留排除信息。

有代码的 Java 模块保持以下结构要求：

- 主 JAR：根目录或 `META-INF/versions/<数字>/` 下有 `module-info.class`，另有至少一个非 module-info/package-info 类；所有 class 通过文件头检查。
- sources JAR：根目录有非空 `module-info.java`，另有至少一个非 module-info/package-info 的非空 Java 源文件。
- Javadoc JAR：非空 `index.html` 和至少一个其他非空 HTML。

无源码的依赖聚合模块仍使用 `jar` packaging，并保留表中全部四个主体。主 JAR 必须有 manifest 且没有任何 `.class`；sources、Javadoc JAR 必须含根目录非空 UTF-8 `README`、`README.md` 或 `README.txt`，说明模块用途和文档入口。三个 JAR 均不能包含 `.java` 或 `.class`，因此代码模块漏打主 JAR 不会仅因变成空包而通过。可同时附带真实许可证，不伪造 Java 源码或 module descriptor。参见 [Spring Boot starter 定义](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html#features.developing-auto-configuration.custom-starter.starter-module)与 [Central 对说明附件的支持](https://central.sonatype.org/publish/requirements/#supply-javadoc-and-sources)。

工具重算校验和并核验所有主体签名及主公钥指纹；签名过期、撤销、错误或缺少公钥均失败。ZIP 路径和条目须合法且不重复，解压上限为单文件 512 MiB、总计 2 GiB，不支持 ZIP64 或分卷。

### 注意事项

这些检查验证结构与发布一致性，不替代测试、Javadoc 内容审阅或 JPMS 运行验证。已有发布证据继续使用其绑定的原共享工作流 SHA，不自动迁移旧模型或改写已留存附件。
