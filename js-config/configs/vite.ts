/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserConfig } from "vite";

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
