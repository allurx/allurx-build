/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from "prettier";

/**
 * 统一代码和文档的排版，在 package.json 的 prettier 字段引用。
 * 不需要格式化的文件放进项目自己的 .prettierignore。
 */
const config: Config = {
    tabWidth: 4,
    printWidth: 120,
    semi: true,
    singleQuote: false,
    // 固定使用 LF，避免在 Windows 与 Linux 之间编辑时整份文件的换行都发生变化。
    endOfLine: "lf",
    embeddedLanguageFormatting: "auto",
    trailingComma: "es5",
};

export default config;
