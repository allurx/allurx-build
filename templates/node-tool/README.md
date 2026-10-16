# Node.js 工具模板

复制本目录到独立工程，修改 `package.json` 的项目名称，再使用 `.node-version` 指定的 Node.js 执行：

```shell
npm install
npm run verify
npm start
```

提交生成的 `package-lock.json`，之后通过 `npm ci` 安装。`.node-version` 选择开发与 CI 的具体运行时，`engines` 声明支持的 Node.js 24.x 范围。`src/` 保存 Node.js 代码，`dist/` 是构建输出；`npm start` 直接运行 TypeScript 源码，交付编译结果时可执行 `node dist/main.js`。

ESLint、Prettier 和 TypeScript 配置来自 `@allurx/js-config`，本模板不安装 Vite 或部署工具。`eslint.config.ts` 由 ESLint 通过 `jiti` 加载，并与业务源码一起接受类型检查。

CI 接入统一仓库的 [Node 验证入口](https://github.com/allurx/allurx-build/blob/main/docs/node.md)，发布方式按实际产物选择；模板默认不向 npm 发布。

## 许可证

模板采用 [Apache-2.0](LICENSE.txt)。分发源码或构建产物时保留这份许可证。
