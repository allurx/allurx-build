# Node.js 工程接入

新建命令行工具或 Node.js 程序时，复制 [Node 工具模板](../templates/node-tool/README.md)；新建静态网站时，复制[静态站点模板](../templates/static-site/README.md)。模板已选好对应工具与配置；按各自 README 填写项目名称、元数据和运行目标，再安装依赖并验证。

已有工程按需要使用 [JS Config](../js-config/README.md) 的配置入口。Node.js 工程使用 `tsconfig/node` 和 ESLint 的 `node` 环境；浏览器代码使用 `tsconfig/browser` 与 `browser` 环境；混合工程分别定义文件范围。Prettier、Vite 和 Wrangler 根据项目任务安装，不让纯 Node.js 工程承担浏览器或部署工具。

项目工具配置统一使用 TypeScript：ESLint 入口为 `eslint.config.ts`，由项目显式声明的开发依赖 `jiti` 加载；Vite 的 `vite.config.ts` 由 Vite 自身加载。配置文件纳入对应的类型检查，具体依赖和最小示例见 [JS Config](../js-config/README.md)。

## 共享验证

项目保留 `.node-version`、`package.json` 和 `package-lock.json`，并定义能完成验收的 `npm run verify`。按[工作流接入步骤](../README.md#接入工作流)取得正式发行的 40 位 SHA，并替换以下占位符：

```yaml
jobs:
    verify:
        uses: allurx/allurx-build/.github/workflows/node-ci.yml@WORKFLOWS_COMMIT_SHA
```

工作流安装指定 Node.js 后执行 `npm ci` 和 `npm run verify`。工程不在仓库根目录时，通过 `working-directory` 指定相对路径；版本文件、锁文件和命令都以该目录为准。多 workspace 工程可以在根 `verify` 中组织完整验证，不需要为每个 workspace 复制 workflow。

Node CI 不发布 npm 包或部署站点。需要 npm 发布时使用[发布指南](release-guide.md)，Cloudflare 站点使用[静态站点工作流](cloudflare-static-site.md)。CI、配置包和发布入口可以独立选择。

## 依赖维护

项目直接声明其使用的工具版本，`@allurx/js-config` 的 peer 范围用于检查兼容性。升级共享配置、TypeScript、ESLint 或运行时后，更新实际锁文件并运行项目完整验证；Node.js 与 `@types/node` 保持对应的大版本。

定期更新使用[共享 Renovate preset](dependency-updates.md)。基础配置更新需要人工审阅，不能因为静态检查通过就跳过项目所需的运行时或交付验证。
