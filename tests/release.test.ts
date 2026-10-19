/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import type { PlannedResponse, RequestLog } from "./fixtures/fetch.ts";
import { zipSync, strToU8 } from "fflate";
import { inspectBundle } from "../src/maven-artifacts.ts";

const preload = new URL("./fixtures/fetch.ts", import.meta.url);
const cli = fileURLToPath(new URL("../src/release.ts", import.meta.url));
const commit = "a".repeat(40);
const deploymentId = "11111111-2222-3333-4444-555555555555";
const identity = { repository: "allurx/fixture", tag: "v1.0.0", commit };
const deployment = { deploymentId, deploymentName: "allurx-fixture-v1.0.0", deploymentState: "PUBLISHED" };
const pomPath = "io/allurx/fixture/1.0.0/fixture-1.0.0.pom";
const files: Record<string, Uint8Array> = {
    [pomPath]: strToU8("<project/>"),
    [`${pomPath}.asc`]: strToU8("signed in the build stage"),
};

async function cliFixture(t: TestContext) {
    const directory = await mkdtemp(join(tmpdir(), "allurx-release-cli-"));
    t.after(() => rm(directory, { recursive: true, force: true }));

    return {
        directory,
        async read(name: string): Promise<Record<string, unknown>> {
            return JSON.parse(await readFile(join(directory, name), "utf8")) as Record<string, unknown>;
        },
        async invoke(
            command: string,
            plan: PlannedResponse[] = [],
            extra: NodeJS.ProcessEnv = {},
            args: string[] = []
        ) {
            const planPath = join(directory, "fetch-plan.json");
            const callsPath = join(directory, "fetch-calls.jsonl");
            const outputPath = join(directory, "outputs");
            await writeFile(planPath, JSON.stringify(plan));
            await writeFile(callsPath, "");
            await writeFile(outputPath, "");
            const result = spawnSync(process.execPath, ["--import", preload.href, cli, command, ...args], {
                cwd: directory,
                encoding: "utf8",
                timeout: 15_000,
                env: {
                    ...process.env,
                    RELEASE_DIR: directory,
                    GITHUB_REPOSITORY: identity.repository,
                    RELEASE_TAG: identity.tag,
                    TAG_PREFIX: "v",
                    EXPECTED_COMMIT: commit,
                    GITHUB_RUN_ATTEMPT: "1",
                    DEPLOYMENT_ID: "",
                    UPLOAD_RETRY_ALLOWED: "false",
                    GITHUB_RELEASE_ALLOW_CREATE: "",
                    GITHUB_RELEASE_ID: "",
                    PACKAGE_DIRECTORY: ".",
                    CENTRAL_USERNAME: "fixture-user",
                    CENTRAL_PASSWORD: "fixture-password",
                    GITHUB_OUTPUT: outputPath,
                    FETCH_PLAN: planPath,
                    FETCH_CALLS: callsPath,
                    ...extra,
                },
            });
            assert.ifError(result.error);
            const log = (await readFile(callsPath, "utf8")).trim();
            return {
                ...result,
                calls: log ? log.split("\n").map((line) => JSON.parse(line) as RequestLog) : [],
                output: await readFile(outputPath, "utf8"),
            };
        },
    };
}

async function mavenFixture(t: TestContext) {
    const f = await cliFixture(t);
    await writeFile(join(f.directory, "bundle.zip"), zipSync(files));
    const manifest = {
        ...(await inspectBundle(join(f.directory, "bundle.zip"))),
        ...identity,
        workflowSha: "b".repeat(40),
    };
    await writeFile(join(f.directory, "manifest.json"), JSON.stringify(manifest));
    return { ...f, manifest };
}

await test("the CLI rejects extra arguments and unknown commands before any release side effect", async (t) => {
    const f = await mavenFixture(t);
    const extra = await f.invoke("upload", [{ text: deploymentId }, { json: deployment }], {}, ["--dry-run"]);
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /without additional arguments/);
    assert.deepEqual(extra.calls, []);
    assert.equal(existsSync(join(f.directory, "publication.json")), false);

    const unknown = await f.invoke("unknown", [], { RELEASE_DIR: "" });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown release command/);
    assert.deepEqual(unknown.calls, []);
});

await test("upload records an unknown outcome before a connection failure and refuses a second upload", async (t) => {
    const f = await mavenFixture(t);
    const failed = await f.invoke("upload", [{ error: "connection lost after sending request" }]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /connection lost/);
    assert.equal(failed.calls.length, 1);
    const [request] = failed.calls;
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.equal(request.bundleName, "bundle.zip");
    assert.ok(request.bundleSize !== undefined && request.bundleSize > 0);
    const journal = await f.read("publication.json");
    assert.equal(journal["state"], "UPLOAD_STATUS_UNKNOWN");

    const repeated = await f.invoke("upload");
    assert.equal(repeated.status, 1);
    assert.deepEqual(repeated.calls, []);
    assert.deepEqual(await f.read("publication.json"), journal);
});

await test("a returned deployment ID survives a status failure and recovery only queries that deployment", async (t) => {
    const f = await mavenFixture(t);
    const failed = await f.invoke("upload", [{ status: 201, text: deploymentId }, { status: 503 }]);
    assert.equal(failed.status, 1);
    assert.equal((await f.read("publication.json"))["deploymentId"], deploymentId);
    assert.match(failed.output, new RegExp(`deployment-id=${deploymentId}`));

    const recovered = await f.invoke("status", [{ json: deployment }], {
        DEPLOYMENT_ID: deploymentId,
        GITHUB_RUN_ATTEMPT: "2",
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(
        recovered.calls.map((call) => new URL(call.url).pathname),
        ["/api/v1/publisher/status"]
    );
    assert.equal((await f.read("publication.json"))["deploymentState"], "PUBLISHED");
});

await test("workflow retries and recovery parameters cannot initiate another upload", async (t) => {
    for (const extra of [{ GITHUB_RUN_ATTEMPT: "2" }, { DEPLOYMENT_ID: deploymentId }]) {
        const f = await mavenFixture(t);
        const result = await f.invoke("upload", [], extra);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Upload is disabled on reruns|Recovery must use status/);
        assert.deepEqual(result.calls, []);
        assert.equal(existsSync(join(f.directory, "publication.json")), false);
    }
});

await test("the controller can permit the first upload after an earlier attempt skipped uploading", async (t) => {
    const f = await mavenFixture(t);
    const result = await f.invoke("upload", [{ status: 201, text: deploymentId }, { json: deployment }], {
        GITHUB_RUN_ATTEMPT: "2",
        UPLOAD_RETRY_ALLOWED: "true",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
        result.calls.map((call) => new URL(call.url).pathname),
        ["/api/v1/publisher/upload", "/api/v1/publisher/status"]
    );
    assert.equal((await f.read("publication.json"))["deploymentState"], "PUBLISHED");
});

await test("controller authorization cannot replace an uncertain upload journal", async (t) => {
    const f = await mavenFixture(t);
    const failed = await f.invoke("upload", [{ error: "connection lost after sending request" }]);
    assert.equal(failed.status, 1);
    const original = await f.read("publication.json");
    assert.equal(original["state"], "UPLOAD_STATUS_UNKNOWN");

    const retried = await f.invoke("upload", [], { GITHUB_RUN_ATTEMPT: "2", UPLOAD_RETRY_ALLOWED: "true" });
    assert.equal(retried.status, 1);
    assert.match(retried.stderr, /EEXIST/);
    assert.deepEqual(retried.calls, []);
    assert.deepEqual(await f.read("publication.json"), original);
});

await test("recovery rejects another repository, tag, commit or a shortened artifact manifest before making requests", async (t) => {
    for (const changed of [
        { repository: "other/project" },
        { tag: "v2.0.0" },
        { commit: "c".repeat(40) },
        { files: [] },
    ]) {
        const f = await mavenFixture(t);
        await writeFile(join(f.directory, "manifest.json"), JSON.stringify({ ...f.manifest, ...changed }));
        const result = await f.invoke("status", [], { DEPLOYMENT_ID: deploymentId });
        assert.equal(result.status, 1);
        assert.deepEqual(result.calls, []);
        assert.match(result.stderr, /identity|does not match its manifest/);
    }
});

await test("a status response for another deployment ID or release name is rejected without replacing known evidence", async (t) => {
    for (const changed of [
        { deploymentId: "99999999-2222-3333-4444-555555555555" },
        { deploymentName: "allurx-fixture-v2.0.0" },
    ]) {
        const f = await mavenFixture(t);
        const original = { deploymentId, state: "UPLOADED", bundleSha256: f.manifest.bundleSha256 };
        await writeFile(join(f.directory, "publication.json"), JSON.stringify(original));
        const result = await f.invoke("status", [{ json: { ...deployment, ...changed } }], {
            DEPLOYMENT_ID: deploymentId,
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /deployment identity/);
        assert.deepEqual(await f.read("publication.json"), original);
    }
});

await test("public verification records success only after comparing every retained artifact", async (t) => {
    const f = await mavenFixture(t);
    const bad = await f.invoke("verify", [{ text: "different published bytes" }]);
    assert.equal(bad.status, 1);
    assert.equal(existsSync(join(f.directory, "public-verification.json")), false);
    const plan = f.manifest.files.map((file) => ({
        base64: Buffer.from(files[file.path] ?? assert.fail(`Missing fixture artifact: ${file.path}`)).toString(
            "base64"
        ),
    }));
    const good = await f.invoke("verify", plan);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.calls.length, f.manifest.files.length);
    assert.equal((await f.read("public-verification.json"))["bundleSha256"], f.manifest.bundleSha256);
});

await test("the native GitHub Release CLI reuses an already verified immutable Release without writes", async (t) => {
    const f = await mavenFixture(t);
    await writeFile(
        join(f.directory, "public-verification.json"),
        JSON.stringify({
            verified: true,
            bundleSha256: f.manifest.bundleSha256,
            files: f.manifest.files.length,
        })
    );
    await writeFile(join(f.directory, "signing-public-key.asc"), "public signing identity fixture");
    const marker = `<!-- allurx-build ${JSON.stringify({ ...identity, bundleSha256: f.manifest.bundleSha256 })} -->`;
    const release = {
        id: 17,
        tag_name: identity.tag,
        body: `${marker}\nGenerated notes`,
        draft: false,
        prerelease: false,
        immutable: true,
        html_url: "https://github.com/allurx/fixture/releases/tag/v1.0.0",
    };
    const assets = await Promise.all(
        ["manifest.json", "public-verification.json", "signing-public-key.asc"].map(async (name) => {
            const bytes = await readFile(join(f.directory, name));
            return {
                name,
                size: bytes.length,
                digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
                state: "uploaded",
            };
        })
    );
    const result = await f.invoke(
        "github-release",
        [
            { json: { object: { type: "tag", sha: "c".repeat(40) } } },
            { json: { object: { type: "commit", sha: commit } } },
            { json: [release] },
            { json: assets },
        ],
        { GH_TOKEN: "fixture-token" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.every((call) => call.method === "GET"));
    assert.match(result.output, /release-url=https:\/\/github.com\/allurx\/fixture\/releases\/tag\/v1.0.0/);
});

async function npmFixture(t: TestContext, tag = identity.tag, prefix = "v") {
    const f = await cliFixture(t);
    const invoke: typeof f.invoke = (command, plan, extra, args) =>
        f.invoke(command, plan, { RELEASE_TAG: tag, TAG_PREFIX: prefix, ...extra }, args);
    const bytes = Buffer.from("retained npm package bytes");
    const packed = {
        filename: "allurx-fixture-1.0.0.tgz",
        name: "@allurx/fixture",
        version: "1.0.0",
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    };
    await writeFile(join(f.directory, packed.filename), bytes);
    await writeFile(join(f.directory, "pack.json"), JSON.stringify([packed]));
    const recorded = await invoke("npm-inspect");
    assert.equal(recorded.status, 0, recorded.stderr);
    return {
        ...f,
        invoke,
        packed,
        published: { name: packed.name, version: packed.version, dist: { integrity: packed.integrity } },
    };
}

await test("the npm Release CLI recovers a known component Release even while the list is empty", async (t) => {
    const tag = "js-config-v1.0.0";
    const f = await npmFixture(t, tag, "js-config-v");
    const verified = await f.invoke("npm-verify", [{ json: f.published }]);
    assert.equal(verified.status, 0, verified.stderr);
    const marker = `<!-- allurx-build ${JSON.stringify({
        repository: identity.repository,
        tag,
        commit,
        name: f.packed.name,
        version: f.packed.version,
        integrity: f.packed.integrity,
    })} -->`;
    const release = {
        id: 17,
        tag_name: tag,
        body: `${marker}\nGenerated notes`,
        draft: false,
        prerelease: false,
        immutable: true,
        html_url: `https://github.com/allurx/fixture/releases/tag/${tag}`,
    };
    const assets = await Promise.all(
        ["npm-manifest.json", "npm-verification.json"].map(async (name) => {
            const bytes = await readFile(join(f.directory, name));
            return {
                name,
                size: bytes.length,
                digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
                state: "uploaded",
            };
        })
    );
    const result = await f.invoke(
        "npm-github-release",
        [
            { json: { object: { type: "tag", sha: "c".repeat(40) } } },
            { json: { object: { type: "commit", sha: commit } } },
            { json: release },
            { json: [] },
            { json: assets },
        ],
        { GH_TOKEN: "fixture-token", GITHUB_RELEASE_ID: "17" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.every((call) => call.method === "GET"));
    assert.ok(result.calls.some((call) => new URL(call.url).pathname.endsWith("/releases/17")));
    assert.match(result.output, /release-url=https:\/\/github.com\/allurx\/fixture\/releases\/tag\/js-config-v1.0.0/);
});

await test("the Release CLI requires explicit creation permission and validates recovery IDs before requests", async (t) => {
    const f = await npmFixture(t);
    const verified = await f.invoke("npm-verify", [{ json: f.published }]);
    assert.equal(verified.status, 0, verified.stderr);
    const emptyList = [
        { json: { object: { type: "tag", sha: "c".repeat(40) } } },
        { json: { object: { type: "commit", sha: commit } } },
        { json: [] },
    ];
    const denied = await f.invoke("npm-github-release", emptyList, { GH_TOKEN: "fixture-token" });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Release creation is not authorized/);
    assert.ok(denied.calls.every((call) => call.method === "GET"));

    const allowed = await f.invoke("npm-github-release", [...emptyList, { error: "creation response lost" }], {
        GH_TOKEN: "fixture-token",
        GITHUB_RELEASE_ALLOW_CREATE: "true",
    });
    assert.equal(allowed.status, 1);
    assert.match(allowed.stderr, /creation response lost/);
    assert.equal(allowed.calls.filter((call) => call.method === "POST").length, 1);

    for (const id of ["0", "wrong", "9007199254740993"]) {
        const invalid = await f.invoke("npm-github-release", [], { GH_TOKEN: "fixture-token", GITHUB_RELEASE_ID: id });
        assert.equal(invalid.status, 1);
        assert.match(invalid.stderr, /positive GitHub Release ID/);
        assert.deepEqual(invalid.calls, []);
    }
});

await test("the npm Release CLI rejects missing verification and changed retained bytes before GitHub requests", async (t) => {
    const f = await npmFixture(t);
    const missing = await f.invoke("npm-github-release", [], { GH_TOKEN: "fixture-token" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /npm-verification.json/);
    assert.deepEqual(missing.calls, []);

    const verified = await f.invoke("npm-verify", [{ json: f.published }]);
    assert.equal(verified.status, 0, verified.stderr);
    await writeFile(join(f.directory, f.packed.filename), "rebuilt package");
    const changed = await f.invoke("npm-github-release", [], { GH_TOKEN: "fixture-token" });
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Retained npm tarball does not match/);
    assert.deepEqual(changed.calls, []);
});

await test("npm recovery skips publishing an identical existing version and verifies the retained tarball", async (t) => {
    const f = await npmFixture(t);
    const check = await f.invoke("npm-check", [{ json: f.published }]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.output, /published=true/);
    assert.ok(check.calls.every((call) => call.method === "GET"));
    const verification = await f.invoke("npm-verify", [{ json: f.published }]);
    assert.equal(verification.status, 0, verification.stderr);
    assert.equal((await f.read("npm-verification.json"))["integrity"], f.packed.integrity);
});

await test("npm check permits a first publish only for a missing version, not a registry failure or conflict", async (t) => {
    const f = await npmFixture(t);
    const missing = await f.invoke("npm-check", [{ status: 404 }]);
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.output, /published=false/);
    for (const response of [
        { status: 503 },
        { error: "registry unavailable" },
        { json: { ...f.published, dist: { integrity: "sha512-different" } } },
        { json: { ...f.published, name: "@another/package" } },
    ]) {
        const result = await f.invoke("npm-check", [response]);
        assert.equal(result.status, 1);
        assert.doesNotMatch(result.output, /published=false|published=true/);
    }
});

await test("npm recovery rejects changed retained bytes and changed release identity without contacting the registry", async (t) => {
    for (const mutate of [
        async (f: Awaited<ReturnType<typeof npmFixture>>) =>
            writeFile(join(f.directory, f.packed.filename), "rebuilt package"),
        async (f: Awaited<ReturnType<typeof npmFixture>>) =>
            writeFile(
                join(f.directory, "npm-manifest.json"),
                JSON.stringify({ ...(await f.read("npm-manifest.json")), tag: "v2.0.0" })
            ),
        async (f: Awaited<ReturnType<typeof npmFixture>>) =>
            writeFile(
                join(f.directory, "npm-manifest.json"),
                JSON.stringify({ ...(await f.read("npm-manifest.json")), workspace: "another-package" })
            ),
    ]) {
        const f = await npmFixture(t);
        await mutate(f);
        const result = await f.invoke("npm-check");
        assert.equal(result.status, 1);
        assert.deepEqual(result.calls, []);
    }
});

await test("npm inspect checks metadata from the actual packed version", async (t) => {
    const f = await npmFixture(t);
    await writeFile(join(f.directory, "pack.json"), JSON.stringify([{ ...f.packed, version: "2.0.0" }]));
    const result = await f.invoke("npm-inspect");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /version does not match/);
});

await test("npm inspect rejects malformed pack metadata before recording a release", async (t) => {
    const f = await cliFixture(t);
    for (const item of [null, []]) {
        await writeFile(join(f.directory, "pack.json"), JSON.stringify([item]));
        const result = await f.invoke("npm-inspect");
        assert.equal(result.status, 1);
        assert.match(result.stderr, /metadata to be an object/);
        assert.deepEqual(result.calls, []);
        assert.equal(existsSync(join(f.directory, "npm-manifest.json")), false);
    }
});
