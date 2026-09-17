# allurx-build 工作指引

本仓库维护共享 GitHub Actions 工作流和 TypeScript 发布 CLI；Maven 构建配置由调用方提供。

## 维护

- 修改接口、工具链或发布行为时，同步检查 `examples/` 和对应文档。
- 共用 CI/CD 文档集中在本仓库；调用方只引用入口，保留自身构建和测试说明。
- `src/` 是源码；`dist/`、`node_modules/` 不手工编辑或提交。

## 开发与验证

- 工具链与验证命令见 [README 本地维护](README.md#本地维护)。
- `prepare`、`deploy`、`finish` 会构建、生成证据或写入外部服务，不作 smoke test。

## 发布逻辑维护

修改发布逻辑时核对 [Maven 接入契约](docs/maven-contract.md) 和 [发布指南](docs/release-guide.md)，保留以下约束：

- 各阶段绑定 annotated tag、发布 commit、其最新 `main` push CI run/attempt 和共享工作流 SHA；区分共享工具 SHA 与业务发布 SHA。
- 调用方的 `main`、`.github/workflows/ci.yml`、`.github/workflows/release.yml` 参与历史查询，改名须同步实现和调用约定。
- 先归档计划，再执行一次 deploy，最后核验公开制品。已进入 deploy 或无法排除上传时，不自动重部署；不以重建结果替代原始证据。
- 公开附件可精简，阶段证据和校验不可削弱。按原发布 bundle 核验公开文件、哈希、签名和 POM，通过后才创建 Release；不声称与 CI 构建字节一致。
- 新 Release 自动生成说明；已有 Release 须核对身份和附件，不覆盖正文或冲突附件，不自动迁移旧格式。
