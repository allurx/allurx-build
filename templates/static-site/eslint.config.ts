/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, globalIgnores } from "eslint/config";
import base, { browser, node, typeChecked } from "@allurx/js-config/eslint";

export default defineConfig(
    // 排除构建和 Wrangler 产生的文件。node_modules 已由 ESLint 默认忽略。
    globalIgnores(["dist/", ".wrangler/"]),
    base,

    // 页面代码和工具配置都检查类型，类型信息来自本项目的 tsconfig.json。
    {
        files: ["src/**/*.ts", "*.ts"],
        extends: [typeChecked],
        languageOptions: {
            parserOptions: { tsconfigRootDir: import.meta.dirname },
        },
    },

    // 分别设置运行环境，检查页面代码中的 process、工具配置中的 document 等误用。
    { files: ["src/**/*.ts"], extends: [browser] },
    { files: ["*.ts"], extends: [node] }
);
