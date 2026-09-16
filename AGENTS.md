# allurx-build 工作指引

本仓库维护可复用 GitHub Actions 工作流和 TypeScript 发布 CLI。工作流编排环境与阶段，`src/` 实现发布门禁和制品核验；Maven 构建配置由调用方提供。

## 维护

- 修改接口、工具链或发布行为时，同步检查 `examples/` 和对应文档。
- 文档只描述本工程；同一约束集中写一处，避免重复说明、导航链接和源码清单。
- `src/` 是源码；`dist/`、`node_modules/` 不手工编辑或提交。依赖变动同步更新 `package.json` 与 lockfile。

## 开发与验证

- Node/npm 以 `package.json` 为准，Actions 工具链以 `.github/actions/setup/action.yml` 为准。根目录验证：

  ```sh
  npm ci --ignore-scripts
  npm run check
  npm run build
  node dist/release.js --help
  ```

- `prepare`、`deploy`、`finish` 会生成证据、执行构建或写入外部服务，不能当作无副作用的 smoke test。上述本地检查不证明 Actions、GPG 或 Central 发布成功；交付时明确实际验证范围。

## 发布逻辑维护

- 各阶段绑定 annotated tag、发布 commit、该 commit 最新的 `main` push CI attempt 和共享工作流 SHA；共享工具 SHA 与业务发布 SHA 不能混淆。
- 调用方的 `main`、`.github/workflows/ci.yml`、`.github/workflows/release.yml` 参与历史查询，改名须同步实现和调用约定。
- 先归档计划，再执行一次 deploy，最后核验公开制品。已进入 deploy 或无法排除上传时，不自动重新部署；原始证据不能用重建结果替代。
- 公开附件是内部证据的汇总，精简附件不能裁剪阶段证据或削弱校验。以实际发布 bundle 核验公开文件、哈希、签名和 POM，通过后才创建 Release；不声称与 CI 构建字节一致。
- 新 Release 自动生成说明；已有 Release 核对身份和附件，不覆盖正文、冲突附件或自动迁移旧格式。
