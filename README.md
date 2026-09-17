# allurx-build

可复用的 Maven CI 与发布工作流，适用于 GitHub.com 公开仓库。

| 工作流 | 行为 |
| --- | --- |
| `maven-ci.yml` | 以 `release` profile 执行 `clean verify`，跳过签名 |
| `maven-central-release.yml` | 校验发布身份，执行一次 Central 部署，核验公开制品，自动生成 GitHub Release |

## 接入

1. 调用方根 POM 提供符合 [Maven 接入契约](docs/maven-contract.md) 的 `release` profile。
2. 复制 [examples/ci.yml](examples/ci.yml) 和 [examples/release.yml](examples/release.yml) 到调用方 `.github/workflows/`。
3. 在调用方创建 `maven-central` Environment，允许 `v*` tag 部署，按需设置审批人，并配置：

   | 类型 | 名称 | 内容 |
   | --- | --- | --- |
   | Secret | `CENTRAL_USERNAME` | Central Portal User Token 的 username |
   | Secret | `CENTRAL_PASSWORD` | 同一 User Token 的 password |
   | Secret | `GPG_PRIVATE_KEY` | ASCII-armored GPG 签名私钥 |
   | Secret | `GPG_PASSPHRASE` | 私钥口令 |
   | Variable | `GPG_FINGERPRINT` | 完整主公钥指纹，40 或 64 位十六进制字符 |

Central Token 需有目标 namespace 的发布权限，签名公钥需已分发；凭据格式见 [Sonatype 文档](https://central.sonatype.org/publish/publish-portal-maven/#credentials)。发布 job 绑定调用方的 `maven-central` Environment。

接入约定：

- `main`、`.github/workflows/ci.yml` 和 `.github/workflows/release.yml` 参与历史查询，不能单独改名；没有 `dev` 时可移除其触发项。
- 保留权限和并发配置；发布调用 job 的 `secrets: inherit` 用于规避 [actions/runner #4453](https://github.com/actions/runner/issues/4453) 报告的 Environment Secret 解析问题。
- 在调用方配置 required CI checks 和正式 tag 的防修改、防删除规则。

### 注意事项

- `secrets: inherit` 向直接调用的工作流传递调用方可访问的全部 secrets，仅对可信工作流启用；Environment 绑定和审批仍由发布 job 执行，见 [GitHub 文档](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow)。
- `@main` 跟随本仓库更新，每次运行按解析出的共享 SHA 检出工具并记录证据。CI 与发布独立运行，可能使用不同工具版本。

## 接口

CI 无自定义 inputs、secrets 或 outputs。发布仅接受 tag push：input `tag` 默认从事件读取，显式传入时须与事件一致；输出 `version`（不含 `v`）、`commit`、`release-url`。

工具链、工作目录和 Maven 参数不可自定义。

### 注意事项

`version` 和 `commit` 来自准备阶段，不代表发布完成。

## 运行 CI 与发布

按示例接入后，推送到 `dev` / `main` 或向其提交 PR 会触发 CI。手动运行时，在调用方 **Actions → CI → Run workflow** 中选择分支。

运行页面提供 job 日志；若生成 Surefire/Failsafe 报告，可下载 `maven-reports-<run_id>-<attempt>` artifact，保留 14 天。required checks 使用实际 CI 产生的名称。

发布准备、tag 操作、结果核验和失败处理见 [发布指南](docs/release-guide.md)。

## 本地维护

Node/npm 版本见 `package.json`，Actions 工具链见 `.github/actions/setup/action.yml`。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run build
node dist/release.js --help
```

### 注意事项

- 本地检查无需发布凭据，不验证真实 Actions 或 Central 发布。
- `main` 是调用方的更新入口；变更须保持接口兼容，并同步示例和文档。
