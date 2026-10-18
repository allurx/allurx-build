# Cloudflare 静态站点

[cloudflare-static-site.yml](../.github/workflows/cloudflare-static-site.yml) 验证调用方站点，并将同次运行的构建产物部署到 Cloudflare Workers Static Assets。项目自己维护页面、构建命令、Wrangler 配置和部署目标；不需要为了使用该工作流安装 `@allurx/js-config`。

## 项目准备

新工程可从[静态站点模板](../templates/static-site/README.md)开始；已有工程按以下契约接入，保留自己的源码目录、workspace、构建插件、测试及交付方式，不需要用模板覆盖现有工程。

- `.node-version` 指定 Node.js，提交 `package-lock.json`，让 `npm ci` 可重复安装。
- `npm run verify` 完成项目验收和生产构建，生成唯一明确的公开资产目录。
- `npm run deploy` 执行 `wrangler deploy`，只部署已有产物，不重新构建。
- `wrangler.jsonc` 维护 Worker 名称、资源配置和域名；Wrangler 作为项目开发依赖固定版本。

Workers 静态资源设置见 [Cloudflare 官方说明](https://developers.cloudflare.com/workers/static-assets/)。

## 凭据与调用

在调用方创建 `production` Environment，限制可部署的生产分支，按需要设置审批，并保存：

| 类型     | 名称                    | 用途                                    |
| -------- | ----------------------- | --------------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账户                    |
| Secret   | `CLOUDFLARE_API_TOKEN`  | 该账户与目标 Worker、域名所需的部署权限 |

权限准备参考 [Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。凭据属于调用方 Environment，不保存在本共享仓库。

调用方定义 PR、分支推送和手动派发事件，按[工作流接入步骤](../README.md#接入工作流)取得正式发行的 40 位 SHA，再替换 `WORKFLOWS_COMMIT_SHA`：

```yaml
jobs:
    site:
        uses: allurx/allurx-build/.github/workflows/cloudflare-static-site.yml@WORKFLOWS_COMMIT_SHA
        secrets: inherit
        with:
            asset-directory: dist/
            production-url: https://example.com
```

`asset-directory` 必须是仓库内一个实际存在的子目录，不接受仓库根目录、通配符、多个路径或目录符号链接。目录只应包含可公开分发的文件，上传时包括 `.well-known` 等隐藏文件。

`production-url` 只决定 GitHub 部署记录的链接，不配置域名。生产分支和 Environment 默认都是 `main`、`production`，可用 `production-branch`、`environment` 显式调整；同时同步调用方事件及 Environment 保护。

## 验证与部署

PR 和非生产分支只执行 `npm ci`、`npm run verify` 和 Wrangler dry-run。只有生产分支的 push 或 `workflow_dispatch` 会上传并部署验证过的同一份产物；部署 job 下载准确 artifact ID，不重新构建。若等待审批期间生产分支已经前进，旧提交会跳过部署。

在 GitHub Actions 核对 `site / verify`，再确认 `site / deploy` 实际成功且未被跳过。到 Cloudflare 核对版本中的 commit SHA 和 Actions 链接，最后检查公开页面、路由、响应头及关键交互。通过 dry-run 不能证明远端权限正确或目标提交已上线。

本地先执行 `npm run verify`，再执行以下无上传检查：

```sh
npm run deploy -- --dry-run
```

`npm run deploy` 会实际发布，执行前须有部署授权。保留一个明确的自动部署入口，避免同时启用 Workers Builds 的 Git 触发器和 Actions 部署。依赖自动合并后的行为见[依赖更新指南](dependency-updates.md)。

## 下载文件与响应变换

Cloudflare 的自动统计或其他响应变换可能向 HTML 注入脚本。对于必须保持字节不变的自包含 HTML 下载，在对应的 [`_headers` 规则](https://developers.cloudflare.com/workers/static-assets/headers/)中设置 `Content-Disposition: attachment`，并在原有 `Cache-Control` 中加入 `no-transform`。例如，保留静态资源默认缓存语义时使用 `public, max-age=0, must-revalidate, no-transform`；不要将下载限制扩展到普通页面。Cloudflare 对自动统计注入的处理见[官方说明](https://developers.cloudflare.com/web-analytics/faq/#my-website-is-proxied-through-cloudflare-but-web-analytics-automatic-setup-is-not-working)。

响应头规则须匹配重定向后的实际下载地址。部署后核对下载响应头，并将下载文件的 SHA-256 与同次 CI 的已验证产物比较；只检查构建目录中的文件，不能证明实际下载内容没有被改写。
