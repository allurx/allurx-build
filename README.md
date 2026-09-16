# allurx-build

可复用的 Maven CI 与发布工作流，适用于 GitHub.com 公开仓库。

| 工作流 | 行为 |
| --- | --- |
| `maven-ci.yml` | 以 `release` profile 执行 `clean verify`，跳过签名；Surefire/Failsafe 报告保留 14 天 |
| `maven-central-release.yml` | 校验发布身份，执行一次 Central 部署，核验公开制品，自动生成 GitHub Release |

## 接入

1. 调用方根目录提供 POM 和 `release` profile，配置测试、sources、Javadoc、GPG 及 Central 插件。
2. 复制 [examples/ci.yml](examples/ci.yml) 和 [examples/release.yml](examples/release.yml) 到调用方 `.github/workflows/`。示例使用 `@main`，每次新运行自动跟随本仓库 `main`，无需逐次更新 SHA。
3. 在调用方创建 `maven-central` Environment，允许 `v*` tag 部署，按需配置 reviewer，并设置：

   | 类型 | 名称 | 内容 |
   | --- | --- | --- |
   | Secret | `CENTRAL_USERNAME` | Central Portal User Token 的 username |
   | Secret | `CENTRAL_PASSWORD` | 同一 User Token 的 password |
   | Secret | `GPG_PRIVATE_KEY` | ASCII-armored GPG 签名私钥 |
   | Secret | `GPG_PASSPHRASE` | 私钥口令 |
   | Variable | `GPG_FINGERPRINT` | 完整主公钥指纹，40 或 64 位十六进制字符 |

Central Token 需有目标 namespace 的发布权限，签名公钥需已分发；凭据格式见 [Sonatype Maven 文档](https://central.sonatype.org/publish/publish-portal-maven/#credentials)。此配置无需 `secrets: inherit`，工作流读取调用方 Environment Secrets，生成 server ID 为 `central` 的 Maven settings，以 `MAVEN_GPG_PASSPHRASE` 传入口令。

保留示例中的调用约定：

- 发布分支 `main`、路径 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml` 参与历史查询，不能单独改名；没有 `dev` 时可移除其触发项，保留 `main` push CI。
- CI 需要 `contents: read`、`actions: read`；发布调用 job 需要 `contents: write`、`actions: read`。内部 Central job 仅有读权限，Release job 使用写权限。
- 发布并发组为 `maven-central-release`，保留 `cancel-in-progress: false`、`queue: max`；调用方自行配置 required CI checks 和正式 tag 的防修改、防删除规则。

每次运行内部仍按实际解析的共享 SHA 检出工具并记录发布证据；CI 与发布是独立运行，期间共享 `main` 更新时可能使用不同工具版本。

## 接口

CI 无自定义 inputs、secrets 或 outputs。发布仅由 tag push 触发；唯一 input `tag` 默认为空，从事件读取，显式传入时必须与事件一致。输出 `version`（不含 `v`）、`commit`、`release-url`；前两项来自准备阶段，不代表发布完成。

不提供自定义工具链、工作目录或 Maven 参数。Maven 硬约束见 [接入契约](docs/maven-contract.md)；发布步骤、证据附件和失败处理见 [发布指南](docs/release-guide.md)。

## 本地维护

Node/npm 版本以 `package.json` 为准；Actions 工具链与 Maven 下载校验以 `.github/actions/setup/action.yml` 为准。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run build
node dist/release.js --help
```

这些检查不需要发布凭据，也不能证明真实 GitHub Actions 或 Central 发布成功。`main` 是调用方自动更新的入口，变更应保持调用接口兼容，并同步核对示例和文档。
