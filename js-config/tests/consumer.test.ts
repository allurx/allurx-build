/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

interface PackageManifest {
    name: string;
    version: string;
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
}

interface PackedPackage {
    filename: string;
    files: { path: string }[];
}

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageManifest;

/**
 * 直接调用 npm 的 JavaScript 入口，避免 Windows 的 npm.cmd 与 shell 转义差异。
 */
function npm(cwd: string, args: string[]): string {
    const npmPath = process.env["npm_execpath"];
    assert.ok(npmPath, "Run the consumer checks through npm test.");
    return run(cwd, [npmPath, ...args]);
}

function run(cwd: string, args: string[]): string {
    const result = spawnSync(process.execPath, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, NPM_CONFIG_ENGINE_STRICT: "true", NPM_CONFIG_STRICT_PEER_DEPS: "true" },
        timeout: 180_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

function write(directory: string, path: string, contents: string): void {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
}

function install(directory: string, tarball: string, tools: string[]): void {
    const devDependencies: Record<string, string> = { [manifest.name]: `file:${tarball.replaceAll("\\", "/")}` };
    for (const tool of tools) {
        const version = manifest.devDependencies[tool];
        assert.ok(version, `${tool} must use the package's tested version.`);
        devDependencies[tool] = version;
    }

    write(directory, "package.json", JSON.stringify({ private: true, type: "module", devDependencies }, null, 4));
    // 安装禁用脚本，也必须可以使用包内的编译结果。
    npm(directory, ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
}

function executable(directory: string, packageName: string, path: string): string {
    return join(directory, "node_modules", packageName, path);
}

await test("the published package works outside the workspace", { timeout: 480_000 }, async (context) => {
    const temporary = mkdtempSync(join(tmpdir(), "allurx-js-config-"));
    try {
        write(root, "dist/stale-fixture.js", "export const stale = true;\n");
        const packed = JSON.parse(npm(root, ["pack", "--json", "--pack-destination", temporary])) as PackedPackage[];
        const archive = packed[0];
        assert.ok(archive);
        const paths = new Set(archive.files.map((file) => file.path));
        for (const path of [
            "dist/eslint.js",
            "dist/eslint.d.ts",
            "dist/prettier.js",
            "dist/prettier.d.ts",
            "dist/vite.js",
            "dist/vite.d.ts",
            "tsconfig/tsconfig.base.json",
            "tsconfig/tsconfig.browser.json",
            "tsconfig/tsconfig.node.json",
            "LICENSE.txt",
        ]) {
            assert.ok(paths.has(path), `The npm tarball is missing ${path}.`);
        }
        assert.ok(!archive.files.some((file) => /^(configs|scripts|tests)\//.test(file.path)));
        assert.ok(!paths.has("dist/stale-fixture.js"), "prepack must remove stale build outputs");
        const tarball = join(temporary, archive.filename);

        await context.test("Node.js needs no Vite, Prettier or deployment tools", () => {
            const directory = join(temporary, "node-consumer");
            install(directory, tarball, ["eslint", "typescript", "@types/node", "jiti"]);
            for (const absent of ["vite", "prettier", "wrangler"]) {
                assert.equal(existsSync(join(directory, "node_modules", absent)), false, `${absent} is optional.`);
            }

            const installed = JSON.parse(
                readFileSync(join(directory, "node_modules", "@allurx/js-config", "package.json"), "utf8")
            ) as PackageManifest;
            for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
                assert.equal(
                    installed.scripts[lifecycle],
                    undefined,
                    "Registry installation must not build the package."
                );
            }

            write(directory, "src/main.ts", "export const runtime: string = process.versions.node;\n");
            write(directory, "src/shared.ts", 'export const message = "Package consumer";\n');
            write(
                directory,
                "tsconfig.json",
                JSON.stringify({ extends: "@allurx/js-config/tsconfig/node", include: ["src", "*.ts"] })
            );
            write(
                directory,
                "eslint.config.ts",
                `
import { defineConfig } from "eslint/config";
import base, { node, typeChecked } from "@allurx/js-config/eslint";
export default defineConfig(base, {
    files: ["src/**/*.ts", "*.ts"],
    extends: [typeChecked, node],
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
});
`
            );
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--noEmit"]);
            run(directory, [
                executable(directory, "eslint", "bin/eslint.js"),
                "src",
                "eslint.config.ts",
                "--max-warnings",
                "0",
            ]);

            write(
                directory,
                "tsconfig.base.json",
                JSON.stringify({
                    extends: "@allurx/js-config/tsconfig/base",
                    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
                    include: ["src/shared.ts"],
                })
            );
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--project", "tsconfig.base.json"]);

            // 从公开 ESLint 入口验证环境隔离，避免只检查配置对象是否与源码相同。
            write(
                directory,
                "boundaries.ts",
                `
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import base, { browser, node } from "@allurx/js-config/eslint";
const cases: [Linter.Config, string, string][] = [
    [browser, "process.pid;", "no-restricted-globals"],
    [browser, "await import('node:fs');", "no-restricted-syntax"],
    [node, "document.title;", "no-restricted-globals"],
];
for (const [environment, source, rule] of cases) {
    const linter = new ESLint({ overrideConfigFile: true, overrideConfig: [...base, environment] });
    const [result] = await linter.lintText(source);
    assert.ok(result);
    assert.ok(result.messages.some((message) => message.ruleId === rule));
}
`
            );
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--noEmit"]);
            run(directory, [executable(directory, "eslint", "bin/eslint.js"), "boundaries.ts", "--max-warnings", "0"]);
            run(directory, ["boundaries.ts"]);
        });

        await context.test("browser builds load the optional Prettier and Vite integrations", () => {
            const directory = join(temporary, "web-consumer");
            install(directory, tarball, ["eslint", "typescript", "@types/node", "prettier", "vite"]);
            write(
                directory,
                "index.html",
                '<!doctype html><html lang="en"><title>Package consumer</title><div id="app"></div><script type="module" src="/src/main.ts"></script></html>\n'
            );
            write(
                directory,
                "src/main.ts",
                'const root = document.querySelector<HTMLDivElement>("#app");\nif (root) root.textContent = "Package consumer";\n'
            );
            write(
                directory,
                "tsconfig.json",
                JSON.stringify({ extends: "@allurx/js-config/tsconfig/browser", include: ["src"] })
            );
            write(
                directory,
                "tsconfig.node.json",
                JSON.stringify({
                    extends: "@allurx/js-config/tsconfig/node",
                    include: ["vite.config.ts", "prettier-export.ts"],
                })
            );
            write(directory, "vite.config.ts", 'export { default } from "@allurx/js-config/vite";\n');
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--noEmit"]);
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--project", "tsconfig.node.json"]);
            run(directory, [executable(directory, "vite", "bin/vite.js"), "build"]);
            assert.ok(readFileSync(join(directory, "dist", "index.html"), "utf8").includes("/assets/"));

            run(directory, [
                executable(directory, "prettier", "bin/prettier.cjs"),
                "--config",
                "node_modules/@allurx/js-config/dist/prettier.js",
                "--write",
                "src/main.ts",
            ]);
            run(directory, [
                executable(directory, "prettier", "bin/prettier.cjs"),
                "--config",
                "node_modules/@allurx/js-config/dist/prettier.js",
                "--check",
                "src/main.ts",
            ]);
            write(
                directory,
                "prettier-export.ts",
                'import assert from "node:assert/strict"; import { format } from "prettier"; import config from "@allurx/js-config/prettier"; assert.ok((await format("const value = 1", { ...config, parser: "typescript" })).endsWith(";\\n"));\n'
            );
            run(directory, [executable(directory, "typescript", "bin/tsc"), "--project", "tsconfig.node.json"]);
            run(directory, ["prettier-export.ts"]);
        });
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
