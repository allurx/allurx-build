/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Linux CI 必须执行；Windows 本地可显式指定 Git Bash，并在 PATH 中提供 jq。
const bash = process.env["ALLURX_TEST_BASH"] ?? (process.platform === "linux" ? "bash" : undefined);
const wrapper = fileURLToPath(new URL("./fixtures/upload-history.sh", import.meta.url)).replaceAll("\\", "/");
const guard = fileURLToPath(new URL("../scripts/assert-upload-not-started.sh", import.meta.url)).replaceAll("\\", "/");
const skipped = { name: "component / Publish retained package", conclusion: "skipped", steps: [] };
const jobWithUpload = (conclusion: string) => ({
    name: skipped.name,
    conclusion: "failure",
    steps: [{ name: "Upload package", conclusion }],
});
const annotation = (attempt: number, run = 42) =>
    `Workflow run: https://github.com/allurx/fixture/actions/runs/${run}\nCreated in attempt: ${attempt}\n`;

await test(
    "upload guard checks the real prior attempts before allowing another upload",
    {
        skip: bash ? false : "Bash integration runs on Linux; set ALLURX_TEST_BASH and provide jq for a local run",
    },
    async (t) => {
        assert.ok(bash);
        const scenarios = [
            { name: "first attempt", attempt: 1, allow: true, called: [] },
            { name: "skipped publish job", histories: { 1: [{ jobs: [skipped] }] }, allow: true, called: [1] },
            {
                name: "skipped upload step",
                histories: { 1: [{ jobs: [jobWithUpload("skipped")] }] },
                allow: true,
                called: [1],
            },
            {
                name: "failed upload",
                histories: { 1: [{ jobs: [jobWithUpload("failure")] }] },
                allow: false,
                called: [1],
            },
            {
                name: "earlier skip cannot hide a later cancelled upload",
                attempt: 3,
                histories: { 1: [{ jobs: [skipped] }], 2: [{ jobs: [jobWithUpload("cancelled")] }] },
                allow: false,
                called: [1, 2],
            },
            {
                name: "ambiguous publish jobs",
                histories: { 1: [{ jobs: [skipped, jobWithUpload("skipped")] }] },
                allow: false,
                called: [1],
            },
            { name: "history request failure", allow: false, called: [1] },
            {
                name: "matching tag starts at its creation attempt and reads all pages",
                attempt: 3,
                annotation: annotation(2),
                histories: { 2: [{ jobs: [] }, { jobs: [skipped] }] },
                allow: true,
                called: [2],
            },
            {
                name: "another run cannot bypass missing history",
                annotation: annotation(2, 99),
                histories: { 1: [{ jobs: [] }] },
                allow: false,
                called: [1],
            },
        ];

        for (const scenario of scenarios) {
            await t.test(scenario.name, async (t) => {
                const directory = await mkdtemp(join(tmpdir(), "allurx-upload-guard-"));
                t.after(() => rm(directory, { recursive: true, force: true }));
                await writeFile(join(directory, "annotation.txt"), scenario.annotation ?? "");
                await writeFile(join(directory, "calls"), "");
                for (const [attempt, pages] of Object.entries(scenario.histories ?? {})) {
                    await writeFile(
                        join(directory, `attempt-${attempt}.json`),
                        pages.map((page) => JSON.stringify(page)).join("\n")
                    );
                }

                const result = spawnSync(bash, [wrapper, guard], {
                    cwd: directory,
                    encoding: "utf8",
                    timeout: 15_000,
                    env: {
                        ...process.env,
                        GITHUB_REPOSITORY: "allurx/fixture",
                        GITHUB_SERVER_URL: "https://github.com",
                        GITHUB_RUN_ID: "42",
                        GITHUB_RUN_ATTEMPT: String(scenario.attempt ?? 2),
                        RELEASE_TAG: "component-v1.0.0",
                    },
                });
                assert.ifError(result.error);
                assert.equal(result.status, scenario.allow ? 0 : 1, result.stderr);
                if (!scenario.allow)
                    assert.match(result.stderr, /A previous upload was entered or cannot be ruled out/);
                const calls = (await readFile(join(directory, "calls"), "utf8")).trim();
                assert.deepEqual(
                    calls ? calls.split("\n") : [],
                    scenario.called.map((attempt) => `repos/allurx/fixture/actions/runs/42/attempts/${attempt}/jobs`)
                );
            });
        }
    }
);
