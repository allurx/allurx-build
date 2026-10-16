/*
 * Copyright 2025 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { builtinModules } from "node:module";
import eslint from "@eslint/js";
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// 同时检查 fs 和 node:fs 两种写法：这里收集短名称，带 node: 前缀的导入单独匹配。
const nodeModuleNames = builtinModules.filter((name) => !name.startsWith("node:"));

/**
 * 检查 JavaScript 中的常见错误。
 * 在 defineConfig 中先加入 base，再用 files 和 extends 为不同文件添加其他规则。
 * 需要忽略的文件由项目自己的 globalIgnores 设置。
 */
const base: Linter.Config[] = defineConfig(eslint.configs.recommended);

/**
 * 根据变量和函数的类型查错，例如发现未处理的 Promise。
 * 用 files 选择文件，并让 parserOptions.tsconfigRootDir 指向项目根目录。
 * 这些文件也要列入 tsconfig.json 或其引用的配置；检查 JavaScript 时须开启 allowJs 和 checkJs。
 * 仍需单独运行 tsc 检查类型错误。
 */
export const typeChecked: Linter.Config[] = defineConfig(
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        name: "allurx/type-checked",
        languageOptions: {
            parserOptions: {
                projectService: true,
                onUnsupportedTypeScriptVersion: "error",
            },
        },
        rules: {
            // 未定义的变量交给 tsc 检查，避免 ESLint 不认识类型声明中的名称而误报。
            "no-undef": "off",
            // 允许在模板字符串中直接写数值，省去手动转字符串。
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            // 保留只用于返回值的泛型，方便调用方指定 DOM 元素类型。
            "@typescript-eslint/no-unnecessary-type-parameters": "off",

            // 只作类型检查的导入写成 import type，避免运行时加载对应模块。
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { prefer: "type-imports", fixStyle: "separate-type-imports" },
            ],
            "@typescript-eslint/no-import-type-side-effects": "error",
        },
    }
);

/**
 * 让 ESLint 识别 window、document 等浏览器对象，并检查误用的 Node.js API。
 * 用 files 选择浏览器文件，可同时加入 typeChecked。
 */
export const browser: Linter.Config = {
    name: "allurx/browser",
    languageOptions: { globals: globals.browser },
    rules: {
        // 依赖包可能带入 Node.js 类型，但浏览器里仍然没有 process 等对象。
        "no-restricted-globals": [
            "error",
            {
                globals: ["process", "Buffer", "global", "__dirname", "__filename", "require", "module", "exports"],
                checkGlobalObject: true,
            },
        ],
        "no-restricted-imports": [
            "error",
            {
                paths: nodeModuleNames,
                patterns: ["node:*"],
            },
        ],

        // 上面的规则只检查 import/export 语句，这里再检查 import("fs") 这样的动态导入。
        "no-restricted-syntax": [
            "error",
            {
                selector: "ImportExpression[source.value=/^node:/]",
                message: "Browser code cannot load Node.js built-in modules.",
            },
            {
                selector: nodeModuleNames.map((name) => `ImportExpression[source.value="${name}"]`).join(", "),
                message: "Browser code cannot load Node.js built-in modules.",
            },
        ],
    },
};

/**
 * 让 ESLint 识别 process 等 Node.js 对象，并检查误用的页面 API。
 * 用 files 选择在 Node.js 中运行的文件，可同时加入 typeChecked。
 */
export const node: Linter.Config = {
    name: "allurx/node",
    languageOptions: { globals: globals.node },
    rules: {
        // 有些依赖会带入 DOM 类型，但 Node.js 里并没有 document 等页面对象。
        "no-restricted-globals": [
            "error",
            {
                globals: [
                    "window",
                    "document",
                    "HTMLElement",
                    "Element",
                    "customElements",
                    "location",
                    "history",
                    "localStorage",
                    "sessionStorage",
                    "matchMedia",
                    "getComputedStyle",
                    "requestAnimationFrame",
                    "cancelAnimationFrame",
                ],
                checkGlobalObject: true,
            },
        ],
    },
};

export default base;
