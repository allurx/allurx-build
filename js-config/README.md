# @allurx/js-config

JavaScript 和 TypeScript 工程共用的 ESLint、Prettier、TypeScript 与 Vite 配置。配置不接管项目命令、Node.js 版本选择或部署工具。

## 安装与选择配置

需要 Node.js 24 或更新版本。以下示例采用 Node.js 24，安装配置包、兼容的检查工具及 TypeScript 配置加载器，并保存实际解析到的精确版本。使用其他 Node.js 版本时，选择对应的 `@types/node`；升级前核对 [package.json](package.json) 的 peer 声明：

```sh
npm install --save-dev --save-exact @allurx/js-config "eslint@^10.12.0" "typescript@~6.0.3" "jiti@^2.7.0" "@types/node@24"
```

| 入口                                 | 用途                                                     | 按需安装的工具                          |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| `@allurx/js-config/eslint`           | 通用规则，以及 `typeChecked`、`browser`、`node` 命名导出 | —                                       |
| `@allurx/js-config/prettier`         | 代码与文档排版                                           | `prettier`                              |
| `@allurx/js-config/tsconfig/base`    | 严格类型检查与 ES2025 标准库                             | —                                       |
| `@allurx/js-config/tsconfig/browser` | 浏览器与打包工具的模块、DOM 类型                         | —                                       |
| `@allurx/js-config/tsconfig/node`    | Node.js 模块与类型擦除语法                               | 与项目 Node.js 版本对应的 `@types/node` |
| `@allurx/js-config/vite`             | 静态多页网站构建                                         | `vite`                                  |

Prettier 与 Vite 是可选 peer，使用相应配置时再安装。ESLint 配置内部需要的插件随本包安装。Wrangler 等部署工具由需要它们的项目自行声明。

## ESLint 与 TypeScript

以下 Node.js 示例使用 `eslint.config.ts`，由 ESLint 通过 `jiti` 加载：

```ts
import { defineConfig, globalIgnores } from "eslint/config";
import base, { node, typeChecked } from "@allurx/js-config/eslint";

export default defineConfig(globalIgnores(["dist/"]), base, {
    files: ["src/**/*.ts", "eslint.config.ts"],
    extends: [typeChecked, node],
    languageOptions: {
        parserOptions: {
            tsconfigRootDir: import.meta.dirname,
        },
    },
});
```

项目的 `tsconfig.json` 指定自己的文件范围。Node.js 配置需要安装 `@types/node`；浏览器代码改用 `tsconfig/browser`，并在 ESLint 中将 `node` 替换为 `browser`。混合工程分别配置两个环境，不把 Node.js 全局对象引入浏览器代码。

```tson
{
    "extends": "@allurx/js-config/tsconfig/node",
    "include": ["src/**/*.ts", "eslint.config.ts"]
}
```

这些 TypeScript 配置默认只查错。需要编译 Node.js 产物时，由项目在构建配置中设置 `noEmit: false`、输出目录，以及与导入方式对应的扩展名重写选项。

## Prettier 与 Vite

使用 Prettier 时，在项目 `package.json` 中设置：

```tson
{
    "prettier": "@allurx/js-config/prettier"
}
```

静态多页网站可以在 `vite.config.ts` 中直接导出公共配置；额外的入口或输出设置通过 Vite 的 `mergeConfig` 合并：

```ts
export { default } from "@allurx/js-config/vite";
```

Vite 配置使用 `mpa` 页面模式，不为未知路径提供 SPA 首页回退。浏览器语法转换沿用 Vite 的 `baseline-widely-available` 目标，缺少的浏览器 API 仍需项目按使用范围处理。

## 维护

在仓库根目录按 workspace 运行本包的 `verify`。检查包含源码检查，以及将真实 npm tarball 安装到仓库外的 Node.js、浏览器消费验证。`prepack` 生成 JavaScript 和类型声明；registry 安装直接读取这些产物，不执行构建生命周期。

许可证为 [Apache-2.0](LICENSE.txt)。
