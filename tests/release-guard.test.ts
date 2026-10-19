/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bash = process.env["ALLURX_TEST_BASH"] ?? (process.platform === "linux" ? "bash" : undefined);
const wrapper = fileURLToPath(new URL("./fixtures/upload-history.sh", import.meta.url)).replaceAll("\\", "/");
const guard = new URL("../scripts/assert-upload-not-started.sh", import.meta.url);
const mavenJob = "Create GitHub Release";
const npmJob = "Create npm GitHub Release (js-config)";
const workflowsJob = "Create workflows GitHub Release";
const priorJob = (name: string, step = "skipped", stepName = "Publish release notes and verification") => ({
    name: `component / ${name}`,
    conclusion: "failure",
    steps: [{ name: stepName, conclusion: step }],
});

await test(
    "Release workflow gates permit creation only when previous publication steps were skipped",
    { skip: bash ? false : "Set ALLURX_TEST_BASH and provide jq for a local Bash integration run" },
    async (t) => {
        assert.ok(bash);
        const scripts: Record<string, string> = {};
        for (const kind of ["npm", "maven-central", "workflows"]) {
            const workflow = await readFile(
                new URL(
                    `../.github/workflows/${kind === "workflows" ? "release" : `${kind}-publish`}.yml`,
                    import.meta.url
                ),
                "utf8"
            );
            // 执行工作流中的原始门禁，避免测试另写的等价条件与实际发布流程分叉。
            const step =
                /- name: Check whether this run may create a Release\r?\n[\s\S]*?run: \|\r?\n((?: {18}[^\r\n]*(?:\r?\n|$)|\r?\n)+)/.exec(
                    workflow
                )?.[1];
            assert.ok(step, `Missing ${kind} Release creation gate`);
            scripts[kind] = step.replace(/^ {18}/gm, "").replaceAll("\r\n", "\n");
        }
        const scenarios = [
            { name: "first npm attempt", kind: "npm", allow: true },
            { name: "first workflows attempt", kind: "workflows", allow: true },
            {
                name: "workflows step was skipped",
                kind: "workflows",
                attempt: 2,
                histories: { "42-1": [priorJob(workflowsJob, "skipped", "Publish workflow release notes")] },
                allow: true,
            },
            {
                name: "workflows step was already entered",
                kind: "workflows",
                attempt: 2,
                histories: { "42-1": [priorJob(workflowsJob, "failure", "Publish workflow release notes")] },
                allow: false,
            },
            {
                name: "npm skipped step",
                kind: "npm",
                attempt: 2,
                histories: { "42-1": [priorJob(npmJob)] },
                allow: true,
            },
            {
                name: "npm entered step is distinct from Maven",
                kind: "npm",
                attempt: 2,
                histories: { "42-1": [priorJob(mavenJob), priorJob(npmJob, "failure")] },
                allow: false,
            },
            {
                name: "ambiguous npm jobs",
                kind: "npm",
                attempt: 2,
                histories: { "42-1": [priorJob(npmJob), priorJob(npmJob)] },
                allow: false,
            },
            {
                name: "another workspace does not authorize this workspace",
                kind: "npm",
                attempt: 2,
                histories: {
                    "42-1": [priorJob("Create npm GitHub Release (other)"), priorJob(npmJob, "failure")],
                },
                allow: false,
            },
            { name: "missing attempt history", kind: "npm", attempt: 2, allow: false },
            {
                name: "legacy Maven job name remains recoverable",
                kind: "maven-central",
                attempt: 2,
                histories: { "42-1": [priorJob(mavenJob), priorJob(npmJob, "failure")] },
                allow: true,
            },
            {
                name: "original run skipped its final attempt",
                kind: "maven-central",
                sourceRun: "99",
                sourceAttempt: "2",
                histories: { "99-2": [priorJob(mavenJob)] },
                allow: true,
            },
            {
                name: "original run entered its final attempt",
                kind: "maven-central",
                sourceRun: "99",
                sourceAttempt: "2",
                histories: { "99-2": [priorJob(mavenJob, "cancelled")] },
                allow: false,
            },
            {
                name: "original run entered an earlier attempt before its skipped final attempt",
                kind: "maven-central",
                sourceRun: "99",
                sourceAttempt: "3",
                histories: { "99-2": [priorJob(mavenJob, "failure")], "99-3": [priorJob(mavenJob)] },
                allow: false,
            },
            { name: "original run lookup failed", kind: "maven-central", sourceRun: "99", allow: false },
        ];
        for (const scenario of scenarios) {
            await t.test(scenario.name, async (t) => {
                const directory = await mkdtemp(join(tmpdir(), "allurx-release-guard-"));
                t.after(() => rm(directory, { recursive: true, force: true }));
                await mkdir(join(directory, ".allurx-build", "scripts"), { recursive: true });
                await copyFile(guard, join(directory, ".allurx-build", "scripts", "assert-upload-not-started.sh"));
                await mkdir(join(directory, "project", "scripts"), { recursive: true });
                await copyFile(guard, join(directory, "project", "scripts", "assert-upload-not-started.sh"));
                await writeFile(join(directory, "gate.sh"), scripts[scenario.kind] ?? assert.fail("Missing gate"));
                await writeFile(
                    join(directory, "annotation.txt"),
                    scenario.sourceRun
                        ? "Workflow run: https://github.com/allurx/fixture/actions/runs/99\nCreated in attempt: 2\n"
                        : ""
                );
                await writeFile(join(directory, "calls"), "");
                await writeFile(join(directory, "environment"), "");
                if (scenario.sourceAttempt)
                    await writeFile(join(directory, "run-99-attempt.txt"), scenario.sourceAttempt);
                for (const [runAttempt, jobs] of Object.entries(scenario.histories ?? {}))
                    await writeFile(
                        join(directory, `run-${runAttempt.replace("-", "-attempt-")}.json`),
                        JSON.stringify({ jobs })
                    );
                const result = spawnSync(bash, [wrapper, "gate.sh", "release"], {
                    cwd: directory,
                    encoding: "utf8",
                    timeout: 15_000,
                    env: {
                        ...process.env,
                        GITHUB_REPOSITORY: "allurx/fixture",
                        GITHUB_SERVER_URL: "https://github.com",
                        GITHUB_RUN_ID: "42",
                        GITHUB_RUN_ATTEMPT: String(scenario.attempt ?? 1),
                        GITHUB_ENV: "environment",
                        RELEASE_TAG: "component-v1.0.0",
                        RELEASE_JOB:
                            scenario.kind === "npm" ? npmJob : scenario.kind === "workflows" ? workflowsJob : mavenJob,
                        SOURCE_RUN: scenario.sourceRun ?? "",
                    },
                });
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr);
                assert.equal(
                    (await readFile(join(directory, "environment"), "utf8")).trim(),
                    `GITHUB_RELEASE_ALLOW_CREATE=${scenario.allow}`
                );
                if (!scenario.allow) {
                    assert.match(result.stdout, /only an existing Release may be recovered/);
                    assert.ok(result.stderr, "Preserve the original history check failure");
                }
                if (scenario.sourceAttempt)
                    assert.match(await readFile(join(directory, "calls"), "utf8"), /runs\/99\/attempts\/2\/jobs/);
            });
        }
    }
);

await test(
    "the workflows Release step distinguishes successful absence from failed or uncertain queries",
    { skip: bash ? false : "Set ALLURX_TEST_BASH and provide jq for a local Bash integration run" },
    async (t) => {
        assert.ok(bash);
        const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
        const step =
            /- name: Publish workflow release notes\r?\n\s+run: \|\r?\n((?: {18}[^\r\n]*(?:\r?\n|$)|\r?\n)+)/.exec(
                workflow
            )?.[1];
        assert.ok(step, "Missing workflows Release publication step");
        const release = { id: 17, tag_name: "workflows-v2.0.0", draft: false, prerelease: false };
        const scenarios = [
            { name: "first creation", allow: true, releases: [], success: true, creates: 1 },
            { name: "list request failed", allow: true, releases: [], error: "list-error", success: false, creates: 0 },
            { name: "empty list during recovery", allow: false, releases: [], success: false, creates: 0 },
            { name: "existing public release", allow: false, releases: [release], success: true, creates: 0 },
            {
                name: "conflicting releases",
                allow: true,
                releases: [release, { ...release, id: 18 }],
                success: false,
                creates: 0,
            },
            {
                name: "existing draft stays untouched",
                allow: true,
                releases: [{ ...release, draft: true }],
                success: false,
                creates: 0,
            },
            {
                name: "lost creation response does not authorize a second POST",
                allow: true,
                releases: [],
                error: "create-error",
                success: false,
                creates: 1,
            },
        ];
        for (const scenario of scenarios) {
            await t.test(scenario.name, async (t) => {
                const directory = await mkdtemp(join(tmpdir(), "allurx-workflows-release-"));
                t.after(() => rm(directory, { recursive: true, force: true }));
                await writeFile(join(directory, "publish.sh"), step.replace(/^ {18}/gm, "").replaceAll("\r\n", "\n"));
                await writeFile(join(directory, "calls"), "");
                await writeFile(join(directory, "releases.json"), JSON.stringify(scenario.releases));
                await writeFile(join(directory, "created-release.json"), JSON.stringify(release));
                await writeFile(join(directory, "release-by-id.json"), JSON.stringify(scenario.releases[0] ?? release));
                if (scenario.error) await writeFile(join(directory, scenario.error), "");
                const invoke = (allow: boolean) =>
                    spawnSync(bash, [wrapper, "publish.sh", "workflows"], {
                        cwd: directory,
                        encoding: "utf8",
                        timeout: 15_000,
                        env: {
                            ...process.env,
                            GITHUB_REPOSITORY: "allurx/fixture",
                            GITHUB_SHA: "a".repeat(40),
                            RELEASE_TAG: release.tag_name,
                            GITHUB_RELEASE_ALLOW_CREATE: String(allow),
                        },
                    });
                const result = invoke(scenario.allow);
                assert.ifError(result.error);
                assert.equal(result.status === 0, scenario.success, result.stderr);
                const calls = await readFile(join(directory, "calls"), "utf8");
                assert.equal(
                    calls.split("\n").filter((line) => line.startsWith("api --method POST ")).length,
                    scenario.creates
                );
                if (scenario.success) {
                    assert.match(result.stdout, /GitHub Release ID: 17/);
                    assert.match(calls, /releases\/17/);
                }
                if (scenario.error === "list-error") assert.match(result.stderr, /release list request failed/);
                if (scenario.error === "create-error") {
                    assert.match(result.stderr, /Connection lost after creating Release/);
                    await writeFile(join(directory, "calls"), "");
                    const retry = invoke(false);
                    assert.notEqual(retry.status, 0);
                    assert.match(retry.stdout, /Release creation is not authorized/);
                    assert.doesNotMatch(await readFile(join(directory, "calls"), "utf8"), /--method POST/);
                }
            });
        }
    }
);
