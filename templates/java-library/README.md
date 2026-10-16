# Java 库模板

使用 JDK 25 和 Maven 3.9.x。复制本目录后，设置自己的 Maven 坐标、项目元数据和 Java 包名，并用实际 API 替换 `Library` 示例类型。

```sh
mvn -B -ntp clean verify
mvn -B -ntp -Prelease "-Dgpg.skip=true" clean verify
```

第二条命令额外生成 sources 和 Javadoc，不签名、不上传。发布入口及凭据配置见[共享发布指南](https://github.com/allurx/allurx-build/blob/main/docs/release-guide.md)。使用已配置的签名身份验证完整 bundle 时，加上 `-Prelease -DskipUpload=true` 执行 `clean deploy`，Central 插件只生成归档，不上传。

父 POM 通过版本化依赖解析。在 allurx-build 开发期间验证尚未发布的父 POM 时，先从仓库的 `maven-parent` 模块安装到隔离的本地 Maven 仓库，再让本模板通过 `-Dmaven.repo.local` 使用该仓库。

共享 Maven CI 的接入方法见[工作流说明](https://github.com/allurx/allurx-build/blob/main/README.md#接入工作流)。普通 CI 不执行发布。

## 许可证

模板采用 [Apache-2.0](LICENSE.txt)。Maven 将同一份许可证复制到主 JAR、sources 和 Javadoc JAR 的 `META-INF/`，不需要另行维护副本。
