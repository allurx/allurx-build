import { defineConfig, globalIgnores } from "eslint/config";
import base, { node, typeChecked } from "@allurx/js-config/eslint";

export default defineConfig(globalIgnores(["dist/"]), base, {
    files: ["src/**/*.ts", "eslint.config.ts"],
    extends: [node, typeChecked],
    languageOptions: {
        parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
});
