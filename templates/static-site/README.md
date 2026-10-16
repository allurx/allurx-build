<!--
Copyright 2026 allurx
SPDX-License-Identifier: Apache-2.0
-->

# 静态站点模板

复制这个模板，就可以用 HTML、TypeScript 和 Vite 开始一个支持桌面与移动设备浏览器的独立网站。共享检查与构建配置由 [JS Config](https://github.com/allurx/allurx-build/tree/main/js-config) 提供，GitHub Actions 通过 allurx-build 部署到 Cloudflare Workers Static Assets。

## 创建网站

把本目录全部复制到新工程，隐藏文件也要保留。安装 [.node-version](.node-version) 指定的完整 Node.js LTS 版本，然后配置项目：

1. 在 [package.json](package.json) 填写工程名称，在 [wrangler.jsonc](wrangler.jsonc) 填写 Worker 名称，在 [index.html](index.html) 修改标题和页面内容。
2. 把 [CI](.github/workflows/ci.yml) 的 `production-url` 换成网站地址。它只决定部署记录中的链接；Worker 实际使用哪个域名，要在 Wrangler 配置中设置。

CI 已固定正式工作流 `v1.0.0` 的完整 commit SHA，无需额外选择版本。保留 `secrets: inherit`；选择其他发行时，按[工作流接入步骤](https://github.com/allurx/allurx-build/blob/main/README.md#接入工作流)更新 SHA 与版本注释。配置包和开发工具使用 npm 精确版本，独立于工作流版本更新。

然后安装依赖、启动开发服务器：

```sh
npm install
npm run dev
```

保存生成的 `package-lock.json`，以后安装使用 `npm ci`。页面写在 `index.html`，浏览器交互写在 [src/main.ts](src/main.ts)，不需要处理、只需原样复制的文件放在 `public/`。

检查、构建和部署工具由项目直接声明，`@allurx/js-config` 只提供共享配置及兼容性约束。[vite.config.ts](vite.config.ts)直接引用共享 Vite 配置，需要插件或项目设置时再用 Vite 的 `mergeConfig` 合并。其他设置在 [eslint.config.ts](eslint.config.ts)、[tsconfig.json](tsconfig.json)和 `package.json` 的 `prettier` 字段中，见 [JS Config 配置说明](https://github.com/allurx/allurx-build/blob/main/js-config/README.md)。ESLint 通过 `jiti` 加载 TypeScript 配置，配置文件也接受类型检查。

## 检查并预览网站

```sh
npm run verify
npm run preview
```

`verify` 先检查格式、ESLint 和类型，再将网站构建到 `dist/`。`preview` 用 Wrangler 预览这个目录里的文件，修改源码后要重新构建。其他命令见 [package.json](package.json)。

保留 viewport、语义 HTML 和缩放，布局按实际空间变化，交互按触摸、鼠标或触控板、键盘及其组合处理，不用设备名称或页面宽窄推断输入能力。加入业务内容后，按功能和风险检查横竖屏、分屏或窗口调整、折叠展开、缩放及实际操作；模拟不能代替真机验证。安全区、软键盘和 PWA 按需处理，不为不同设备另建工程或预加交互框架。

## 部署网站

首次推送 `main` 前，在 GitHub 仓库创建 `production` Environment，只允许 `main` 部署，并添加 Secret `CLOUDFLARE_API_TOKEN` 和 Variable `CLOUDFLARE_ACCOUNT_ID`。如何准备这些值和域名，见 [allurx-build 部署说明](https://github.com/allurx/allurx-build/blob/main/docs/cloudflare-static-site.md)。

完成上面的构建后，检查 Wrangler 配置：

```sh
npm run deploy -- --dry-run
```

**推送或显式派发 `main` 的 CI 会部署到生产环境。** PR 只检查。部署使用这次检查和构建生成的同一批文件；在 Actions 中查看 `site / verify` 和 `site / deploy`，分支保护需要验证检查时选择 `site / verify`。部署后再核对 Cloudflare 版本和实际网页，步骤见部署说明。

## 更新依赖

配置包和项目直接使用的工具都在 `package.json` 中声明。新增业务依赖时，[.npmrc](.npmrc) 会让 npm 保存精确版本；保留锁文件，让本地和 CI 安装相同的依赖。

[Renovate 配置](.github/renovate.json)继承 allurx-build 的共享更新策略，集中处理 npm、GitHub Actions 和 Node.js 版本。配置包和共享工作流更新保留人工审核，工具升级须满足配置包的 peer 兼容性要求。接入、PR 处理及失败恢复见 [共享依赖更新指南](https://github.com/allurx/allurx-build/blob/main/docs/dependency-updates.md)。

Node.js 运行时固定在本项目的 `.node-version` 和 `package.json` 的 `engines` 中；升级时同步两处，并通过完整验证。

## 许可证

模板采用 [Apache-2.0](LICENSE.txt)。`public/LICENSE.txt` 保留相同的许可证，构建时会和网站文件一起复制到 `dist/`。
