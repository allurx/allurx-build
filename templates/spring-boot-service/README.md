# Spring Boot 服务模板

使用 JDK 25 和 Maven 3.9.x。复制本目录后，设置自己的 Maven 坐标和 Java 包名，再添加实际服务功能。

```sh
mvn -B -ntp clean verify
java -jar target/spring-boot-service-1.0.0.jar
```

`verify` 包含应用上下文启动测试，并生成可执行 JAR。修改项目坐标后，启动命令应使用 `target/` 中实际生成的文件名。此模板继承官方 `spring-boot-starter-parent`，依赖和插件版本由 Spring Boot 管理，不依赖 Allurx Maven parent，也不配置 Maven Central 发布。

共享 Maven CI 可以验证这个项目，接入方法见[工作流说明](https://github.com/allurx/allurx-build/blob/main/README.md#接入工作流)。应用部署应使用项目选择的运行环境和已构建的可执行产物。

## 许可证

模板采用 [Apache-2.0](LICENSE.txt)。Maven 将同一份许可证复制到应用资源的 `META-INF/`，并打入可执行 JAR。
