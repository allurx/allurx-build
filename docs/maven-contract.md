# Maven 接入契约

普通 [maven-ci.yml](../.github/workflows/maven-ci.yml) 运行项目自己的 `clean verify`，不要求 `release` profile 或 `io.allurx:maven-parent`。它可用于 Java 库、Spring Boot 应用及其他 Maven 工程；可通过 `working-directory` 和 `java-version` 指定工程目录与 JDK。

以下要求只适用于 [maven-central-publish.yml](../.github/workflows/maven-central-publish.yml) 的正式发布。

## 发布配置

项目以显式 `release` profile 提供 sources、Javadoc、GPG 签名和 Central 发布插件。可以继承本仓库的 [Maven parent](../maven-parent/README.md)，也可以自行提供等价配置；业务依赖、模块、annotation processor 和专有测试仍由项目维护。

发布插件必须支持只生成 bundle 的 `skipUpload`；本仓库 parent 使用的版本由 [pom.xml](../maven-parent/pom.xml) 维护。Central `0.12.0` 引入此选项，流程先生成并检查 bundle，再由独立上传步骤提交同一文件，见 [Sonatype 插件说明](https://central.sonatype.org/publish/publish-portal-maven/#skipupload)。

发布版本必须是稳定 SemVer，annotated tag 的前缀由 `tag-prefix` 指定，去掉前缀后的版本须与项目一致。消费者通常使用 `vX.Y.Z`；本仓库 parent 使用 `maven-parent-vX.Y.Z`。不发布 SNAPSHOT，不移动或复用已有正式 tag。

## Reactor 与产物

正式构建运行完整 reactor，不跳过有效测试。需要排除示例模块时使用 Central 原生 `skipPublishing`，不要用测试跳过或 `maven.deploy.skip` 表达发布范围；排除模块仍须构建验证。项目负责保证发布模块的父 POM 与依赖可以从消费者环境解析。

一次发布只生成一个 `target/central-publishing/central-bundle.zip`。POM 元数据、坐标、sources/Javadoc 和发布资格遵循 [Maven Central 要求](https://central.sonatype.org/publish/requirements/)；Maven 插件与 Central 负责模型语义和服务端校验，共享工具不实现第二套 Maven 模型解释器。

上传前，共享工具检查 bundle 路径、重复条目和解压大小，核对已有校验文件，要求制品具有对应签名，并使用指定 GPG 指纹验签。manifest 记录 bundle 摘要以及每个文件的路径、大小和 SHA-256，并绑定仓库、tag、commit 与共享工具版本。

Central 返回 `PUBLISHED` 后，流程从公开 Maven 仓库逐个下载原 manifest 中的文件，核对大小和摘要，再生成公开验证结果。该检查证明发布字节与保存的 bundle 一致，不能替代 API、JPMS、Javadoc 内容或应用行为测试。

## 调用与验证

工作流输入包括 `tag`、`tag-prefix`、`working-directory`、`java-version`；恢复使用 `recovery-run-id` 和 `deployment-id`，具体操作见[发布指南](release-guide.md)。普通发布不填写恢复参数。

本地无上传检查可以执行：

```sh
mvn -B -ntp clean verify
mvn -B -ntp -Prelease -Dgpg.skip=true clean verify
```

签名 bundle 的生成还需要有效 GPG 环境；不要把缺少凭据时的跳过结果当作签名验收。正式发布权限、原始产物保存和失败恢复统一见[发布指南](release-guide.md)。
