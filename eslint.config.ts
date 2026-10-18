/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, globalIgnores } from "eslint/config";
import base, { node, typeChecked } from "@allurx/js-config/eslint";

export default defineConfig(
    globalIgnores(["dist/", ".local/", ".vscode/", "js-config/", "maven-parent/", "templates/"]),
    base,
    {
        files: ["*.ts", "src/**/*.ts", "tests/**/*.ts"],
        extends: [typeChecked, node],
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: import.meta.dirname,
            },
        },
    }
);
