/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin, UserConfig } from "vite";

/**
 * 构建时将 Vite 最终 root 中的 LICENSE.txt 原样交付到输出根目录。
 * 修改 root 后，许可证来源随之改变；文件缺失或不可读时构建失败。
 * 按需放入 plugins，不影响默认配置或开发服务器。
 */
export function projectLicense(): Plugin {
    return {
        name: "allurx:project-license",
        apply: "build",
        generateBundle() {
            this.emitFile({
                type: "asset",
                fileName: "LICENSE.txt",
                source: readFileSync(join(this.environment.config.root, "LICENSE.txt")),
            });
        },
    };
}

/**
 * 静态网站的 Vite 配置。需要额外设置时，用 Vite 的 mergeConfig 合并。
 */
const config: UserConfig = {
    // 不存在的页面返回 404，不回退到首页。
    appType: "mpa",

    build: {
        // 按 Vite 默认支持的浏览器范围转换 JavaScript 语法；缺少的 API 仍需另行处理。
        target: "baseline-widely-available",
        // 不额外注入预加载脚本；不支持预加载的浏览器仍会正常加载模块。
        modulePreload: { polyfill: false },
    },
};

export default config;
