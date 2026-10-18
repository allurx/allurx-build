# Node.js 工程接入

新建命令行工具或 Node.js 程序时，复制 [Node 工具模板](../templates/node-tool/README.md)；新建静态网站时，复制[静态站点模板](../templates/static-site/README.md)。模板已选好对应工具与配置；按各自 README 填写项目名称、元数据和运行目标，再安装依赖并验证。

已有工程按需要使用 [JS Config](../js-config/README.md) 的配置入口。Node.js 工程使用 `tsconfig/node` 和 ESLint 的 `node` 环境；浏览器代码使用 `tsconfig/browser` 与 `browser` 环境；混合工程分别定义文件范围。Prettier、Vite 和 Wrangler 根据项目任务安装，不让纯 Node.js 工程承担浏览器或部署工具。

项目工具配置统一使用 TypeScript：ESLint 入口为 `eslint.config.ts`，由项目显式声明的开发依赖 `jiti` 加载；Vite 的 `vite.config.ts` 由 Vite 自身加载。配置文件纳入对应的类型检查，具体依赖和最小示例见 [JS Config](../js-config/README.md)。

## 默认结构与命令

工具入口保留在工程根目录，共同规则通过共享配置继承，项目只声明自己的文件范围、插件和交付特性。浏览器配置统一命名为 `tsconfig.browser.json`，Node.js 配置为 `tsconfig.node.json`；确有独立类型环境的测试使用 `tsconfig.test.json`。混合工程由根 `tsconfig.json` 的 `references` 汇总；只有一个环境的工程可直接在根配置中继承对应共享入口，不创建空的子项目。

各工程采用以下命令语义，模板已提供相应入口：

| 命令                      | 默认行为                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `format` / `format:check` | 通过 `prettier .` 格式化或检查维护文件；排除范围放在 `.prettierignore`              |
| `lint`                    | 通过 `eslint . --max-warnings 0` 检查；适用文件、环境及生成物排除放在 ESLint 配置中 |
| `type-check`              | 通过 `tsc -b --noEmit` 检查根项目及其引用的所有环境                                 |
| `check`                   | 依次执行格式、lint 和类型检查                                                       |
| `build`                   | 生成项目产物，具体构建方式由项目维护                                                |
| `verify`                  | 执行完整门禁，组合静态检查、必要构建、测试及产物校验                                |

类型检查由原生 TypeScript 管理项目引用；每个叶配置通过 `tsBuildInfoFile` 将独立的构建状态记录放在 `node_modules/.cache/typescript/`，不向源码目录写入生成文件。这里使用 `--build` 模式，[TypeScript 5.6 起会写入构建信息](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-6.html#allow---build-with-intermediate-errors)，无需另设 `incremental`；这与普通 `tsc -p` 的行为不同，也不表示已启用完整的增量类型检查缓存。构建记录可删除，不提交 Git，也不随产物交付。

输出 JavaScript 的构建配置独立继承共享基线，避免依赖检查入口的环境组合。双版本 TypeScript 使用[官方别名接入方式](../js-config/README.md#eslint-与-typescript)，通过原生命令选择编译器，不在工程脚本中固定 `node_modules` 内部路径。

项目直接使用的工具显式声明为开发依赖，配置包内部依赖由配置包维护。默认值以模板和共享包为准；实际语言、运行环境、内容保真或交付要求形成的差异，在对应配置附近说明。自举配置包需要先生成其公共入口再执行检查时，由该包的 `verify` 安排顺序，不改变消费者的命令语义。

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
