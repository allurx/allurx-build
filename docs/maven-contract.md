# Maven 接入契约

本文描述当前发布工具实际接受的 Maven 模型和制品。首次配置工作流与凭据见 [README](../README.md)，发布操作见[发布指南](release-guide.md)。

这些约束包含本项目对版本、JPMS、完整 reactor 和插件配置的额外限制；Maven Central 的通用要求见 [Sonatype 发布要求](https://central.sonatype.org/publish/requirements/)。校验实现以 [src/artifacts.ts](../src/artifacts.ts) 为准。

## 版本与 reactor

- tag 必须是 `vMAJOR.MINOR.PATCH`，如 `v1.2.3`；各数字段除 `0` 外不能以零开头，不接受 `-rc.1` 或 `+build` 等后缀。
- reactor 中每个模块的 effective `version` 必须等于去掉 `v` 的 tag 版本，坐标不能重复。
- 发布从仓库根 POM 处理完整 reactor，不使用 `-N`、`-pl`，不跳过或排除模块。
- effective POM 中除 `profiles`、`properties` 子树之外的所有 `version` 元素都必须是固定稳定版本，包含父 POM、依赖、插件及其管理配置；profile 激活后进入生效模型的配置仍会被检查。

固定稳定版本接受数字分段，以及可选的 `Final`、`GA`、`RELEASE`、`SP数字` 后缀，后缀前为 `.` 或 `-`，大小写不敏感。例如 `25`、`3.5.2`、`1.0.Final`、`2.0-SP1`。不接受 `SNAPSHOT`、RC/beta、版本范围、`LATEST`、`RELEASE` 单独作为版本或未解析的 `${...}`。

## release profile

业务 POM 负责定义编译、测试、sources、Javadoc 和 GPG 签名，公共配置可由 `allurx/maven-parent` 继承。共享工作流激活 `release` profile，不能替代这些 POM 配置。

每个模块的 effective POM 需包含下列 Central 插件配置；以下片段只展示发布插件，不是完整的 `release` profile：

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

保留插件扩展自动注入的单个 `injected-central-publishing` execution（`deploy` 阶段、`publish` goal）；无需手写重复 execution。发布命令统一传入 `autoPublish=true`、`waitUntil=published`、`gpg.bestPractices=true`、签名指纹、deployment name 和提交时间戳。

| 配置项 | 当前要求 |
| --- | --- |
| 发布目标 | 使用 `https://central.sonatype.com`，server ID 为 `central` |
| bundle | 保留默认目录与文件名，最终只有一个 `target/central-publishing/central-bundle.zip` |
| staging / deferred 目录 | 保留默认配置 |
| 自动发布 | 不覆盖工作流提供的 `autoPublish`、`waitUntil` 和 `deploymentName` |
| 校验和 | `checksums` 使用默认值、`all` 或 `required` |
| 等待设置 | 如显式配置，`waitMaxTime` 为 1800–7200 秒，`waitPollingInterval` 为 5–60 秒；仍受发布 job 的 60 分钟超时限制 |
| 旧等待参数 | 不使用 `waitForPublishCompletion`、`publishCompletionPollInterval` |

以上是工具的配置白名单，不代表接受 Central 插件的所有合法选项。插件参数含义见 [Sonatype Maven 文档](https://central.sonatype.org/publish/publish-portal-maven/#plugin-configuration-options)。

发布配置不能跳过测试、部署、sources、Javadoc 或签名；也不能启用 `ignorePublishedComponents`、`excludeArtifacts`，或将 `attach`、`failOnBuildFailure` 设为 `false`。仅允许标准 `sources`、`javadoc` classifier，不支持额外 classifier 或 `test-jar` 附件。

GPG 配置需能从 `MAVEN_GPG_PASSPHRASE` 环境变量读取口令，并使用工作流导入的私钥完成非交互签名。普通 CI 显式传入 `gpg.skip=true`，正式发布不跳过签名。

## POM 元数据

每个模块在 effective POM 中需具备以下非空且已解析的元数据：

- `name`、`description`、`url`。
- 至少一个 `license`，每项包含 `name` 和 `url`。
- 至少一个 `developer`，每项至少提供 `name` 或 `id`。
- `scm.url`、`scm.connection`、`scm.developerConnection`。

发布后还会读取公开 POM，并沿其父 POM 链解析继承元数据。reactor 以外的父 POM 必须能从 Maven Central 下载；不能只存在于本地或私有仓库。工具会拒绝循环或过深的父链。

## 制品与签名

| packaging | 必须发布的主体文件 |
| --- | --- |
| `pom` | `<artifactId>-<version>.pom` |
| `jar` | POM、主 JAR、`-sources.jar`、`-javadoc.jar` |

主体数量为 `pom` 模块数加上 `jar` 模块数的四倍，不含签名和校验和。例如 1 个父 POM、4 个 JAR 模块对应 17 个主体文件，完整 bundle 的文件数更多。

每个主体必须包含 `.asc` 签名以及 `.md5`、`.sha1` 校验和；可另含 `.sha256`、`.sha512` 和签名文件的校验和。实际文件集合必须与 reactor 模型吻合，不接受缺失、空文件或额外制品。

JAR 的内容要求如下：

- 主 JAR 包含根目录或 `META-INF/versions/<数字>/` 下的 `module-info.class`，以及至少一个非 `module-info` / `package-info` 的类文件；所有类文件通过 class 文件头检查。
- sources JAR 包含根目录的非空 `module-info.java`，以及至少一个非 `module-info.java` / `package-info.java` 的非空 Java 源文件。
- Javadoc JAR 包含非空 `index.html` 和至少一个其他非空 HTML 文件。

bundle 内校验和会重新计算；所有主体签名必须有效，且签名所对应的主公钥指纹与计划一致。过期、撤销、错误或缺失公钥的签名会导致停止。归档解析还限制路径、重复条目及解压大小（单文件 512 MiB、总计 2 GiB），不支持 ZIP64 或分卷 ZIP。

这些检查验证制品结构和发布一致性，不替代业务测试、Javadoc 内容审阅或完整的 JPMS 运行验证。

## 公开核验

Central 确认为 `PUBLISHED` 后，工具从 `https://repo.maven.apache.org/maven2` 下载 manifest 中的**每个文件**，核对大小与 SHA-256，并用原归档公钥验证下载到的主体签名、检查公开 POM 元数据及外部父 POM。

核验以实际文件下载为准，不依赖 Central 搜索索引是否已收录。`public-verification.json` 记录主体数、文件数、签名验证数、bundle SHA-256 和外部父 POM 信息；全部通过后才进入 GitHub Release 阶段。
