# Maven 接入契约

以下是当前工具的硬约束；工作流从调用方根 POM 处理完整 reactor。

## 版本与模型

- tag 为 `vMAJOR.MINOR.PATCH`，各段除 `0` 外不以零开头，不接受后缀；所有模块版本等于去掉 `v` 的 tag 版本，坐标不能重复。
- 仅支持 `pom`、`jar` packaging，不支持 SNAPSHOT、局部 reactor、额外 classifier 或 `test-jar`；不能用 `-N`、`-pl` 或排除模块。
- 自身发布版本始终为上述严格的 `MAJOR.MINOR.PATCH`，所有 reactor 模块保持一致；制品模型和 bundle 核验也执行此限制。
- effective POM 中除 `profiles`、`properties` 子树外，第三方依赖、父 POM、插件及管理配置的 `version` 必须非空、无空白、已解析，且为固定非 SNAPSHOT 版本；激活 profile 后进入生效模型的内容也会检查。拒绝 `LATEST`、单独的 `RELEASE`、版本范围、通配符、未解析变量、`SNAPSHOT` 和 Maven 时间戳快照。
- 第三方固定版本不使用后缀白名单；是否采用预发布依赖由调用方决定。用于下载父 POM 的坐标仍须通过路径安全检查。

## release profile

调用方配置编译、测试、sources、Javadoc 和 GPG 签名。每个模块的 effective POM 必须含以下 Central 插件：

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

只保留扩展自动注入的单个 `injected-central-publishing` execution：`deploy` 阶段、`publish` goal。工作流传入 `autoPublish=true`、`waitUntil=published`、`gpg.bestPractices=true`、签名指纹、deployment name 和提交时间戳。

| 配置 | 允许值或限制 |
| --- | --- |
| Central 地址 / server ID | `https://central.sonatype.com` / `central` |
| bundle | 根项目或子模块的默认 `target/central-publishing/central-bundle.zip`，完整 reactor 仅生成一个 |
| staging / deferred 目录 | 默认配置 |
| `autoPublish` / `waitUntil` / `deploymentName` | 不覆盖工作流提供的值 |
| `checksums` | 默认值、`all` 或 `required` |
| `waitMaxTime` / `waitPollingInterval` | 显式设置时分别为 1800–7200 秒 / 5–60 秒 |
| `waitForPublishCompletion` / `publishCompletionPollInterval` | 禁止使用 |

发布不能跳过测试、部署、sources、Javadoc、签名，不能启用 `ignorePublishedComponents`、`excludeArtifacts`，不能将 `attach`、`failOnBuildFailure` 设为 `false`；classifier 仅允许标准 `sources`、`javadoc`。

GPG 从 `MAVEN_GPG_PASSPHRASE` 读取口令，以工作流导入的私钥非交互签名。普通 CI 传入 `gpg.skip=true`，正式发布不跳过签名。

### 注意事项

- 上述 XML 片段不是完整 profile。
- 插件配置按白名单校验，不接受其全部合法选项。
- 发布 job 上限为 60 分钟。

## 元数据与制品

每个模块的 effective POM 必须有非空、已解析的 `name`、`description`、`url`、完整 SCM 三项（`url`、`connection`、`developerConnection`），至少一个 license（每项含 name/url）和 developer（每项含 name 或 id）。公开 POM 的元数据也会沿父链核验；外部父 POM 必须可从 Maven Central 下载，父链不能循环或过深。

| packaging | 必须发布的主体 |
| --- | --- |
| `pom` | `<artifactId>-<version>.pom` |
| `jar` | POM、主 JAR、`-sources.jar`、`-javadoc.jar` |

每个主体必须有 `.asc`、`.md5`、`.sha1`，可另含 `.sha256`、`.sha512` 和签名文件校验和。文件集合必须与 reactor 一致，不能缺失、为空或多出制品。

- 主 JAR：根目录或 `META-INF/versions/<数字>/` 下有 `module-info.class`，另有至少一个非 module-info/package-info 类；所有 class 通过文件头检查。
- sources JAR：根目录有非空 `module-info.java`，另有至少一个非 module-info/package-info 的非空 Java 源文件。
- Javadoc JAR：非空 `index.html` 和至少一个其他非空 HTML。

工具重算校验和，核验所有主体签名及其主公钥指纹；过期、撤销、错误或缺失公钥的签名均失败。ZIP 路径和条目须合法且不重复，解压上限单文件 512 MiB、总计 2 GiB，不支持 ZIP64 或分卷。

### 注意事项

这些检查验证结构与发布一致性，不替代测试、Javadoc 内容审阅或 JPMS 运行验证。
