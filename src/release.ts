/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { readFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { inspectBundle, verifyPublic, verifySignatures, type BundleManifest } from "./maven-artifacts.ts";
import { publishGithubRelease } from "./github-release.ts";
import { assert, env, readJson, run, writeJson } from "./util.ts";

const commands = [
    "check-tag",
    "inspect",
    "upload",
    "status",
    "verify",
    "github-release",
    "npm-inspect",
    "npm-check",
    "npm-verify",
    "npm-github-release",
];
const central = "https://central.sonatype.com/api/v1/publisher";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface ReleaseIdentity {
    repository: string;
    tag: string;
    commit: string;
}

interface NpmManifest extends ReleaseIdentity {
    schemaVersion: 1;
    workspace: string;
    filename: string;
    name: string;
    version: string;
    integrity: string;
}

/**
 * 从组件 tag 提取稳定版本号，不接受预发布版本或前导零。
 */
export function releaseVersion(tag: string, prefix: string): string {
    assert(tag.startsWith(prefix), `Tag must start with ${prefix}`);
    const version = tag.slice(prefix.length);
    assert(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version), "Expected a stable semantic version");
    return version;
}

async function output(name: string, value: string): Promise<void> {
    assert(!/[\r\n]/.test(value), "Workflow output must be one line");
    if (process.env["GITHUB_OUTPUT"]) await appendFile(process.env["GITHUB_OUTPUT"], `${name}=${value}\n`);
}

function expectedIdentity(): ReleaseIdentity {
    const commit = env("EXPECTED_COMMIT");
    assert(/^[0-9a-f]{40}$/.test(commit), "Expected the release tag commit");
    return { repository: env("GITHUB_REPOSITORY"), tag: env("RELEASE_TAG"), commit };
}

function githubReleaseOptions() {
    const id = env("GITHUB_RELEASE_ID", "");
    assert(!id || /^[1-9][0-9]*$/.test(id), "Expected a positive GitHub Release ID");
    return {
        token: env("GH_TOKEN"),
        allowCreate: env("GITHUB_RELEASE_ALLOW_CREATE", "false") === "true",
        ...(id ? { releaseId: Number(id) } : {}),
    };
}

function checkIdentity(manifest: Record<string, unknown>): ReleaseIdentity {
    const expected = expectedIdentity();
    assert(
        manifest["repository"] === expected.repository &&
            manifest["tag"] === expected.tag &&
            manifest["commit"] === expected.commit,
        "Retained release identity does not match the requested repository, tag and commit"
    );
    return expected;
}

async function checkTag(): Promise<void> {
    const tag = env("RELEASE_TAG");
    const version = releaseVersion(tag, env("TAG_PREFIX", "v"));
    assert((await run("git", ["cat-file", "-t", `refs/tags/${tag}`])) === "tag", "Release tag must be annotated");
    const commit = await run("git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
    assert(commit === (await run("git", ["rev-parse", "HEAD"])), "Checkout must match the release tag");
    const expected = env("PROJECT_VERSION");
    assert(version === expected, `Tag version ${version} does not match project version ${expected}`);
    await output("version", version);
    await output("commit", commit);
}

/**
 * 重新检查保留的 bundle，并将 manifest 作为比对证据，避免信任其中的路径或摘要。
 */
async function retainedBundle(directory: string): Promise<BundleManifest> {
    const saved = await readJson(join(directory, "manifest.json"));
    checkIdentity(saved);
    const actual = await inspectBundle(join(directory, "bundle.zip"));
    assert(
        saved["schemaVersion"] === actual.schemaVersion &&
            saved["bundleSha256"] === actual.bundleSha256 &&
            isDeepStrictEqual(saved["files"], actual.files),
        "Retained bundle does not match its manifest"
    );
    return actual;
}

function npmFilename(value: unknown): string {
    assert(typeof value === "string" && /^[A-Za-z0-9._-]+\.tgz$/.test(value), "Expected one npm tarball filename");
    return value;
}

async function npmIntegrity(directory: string, filename: string): Promise<string> {
    return `sha512-${createHash("sha512")
        .update(await readFile(join(directory, filename)))
        .digest("base64")}`;
}

/**
 * 记录 npm 完成 prepack 后实际生成的 tarball，并核对其元数据。
 */
async function inspectNpm(directory: string): Promise<void> {
    const packages: unknown = JSON.parse(await readFile(join(directory, "pack.json"), "utf8"));
    assert(Array.isArray(packages) && packages.length === 1, "Expected exactly one packed npm package");
    const value: unknown = packages[0];
    assert(
        value !== null && typeof value === "object" && !Array.isArray(value),
        "Expected npm pack metadata to be an object"
    );
    const packed = value as Record<string, unknown>;
    const filename = npmFilename(packed["filename"]);
    const version = releaseVersion(env("RELEASE_TAG"), env("TAG_PREFIX", "v"));
    assert(
        typeof packed["name"] === "string" && packed["name"].length > 0 && packed["version"] === version,
        "Packed npm package version does not match the release tag"
    );
    const integrity = await npmIntegrity(directory, filename);
    assert(packed["integrity"] === integrity, "npm pack metadata does not match the retained tarball");
    await writeJson(join(directory, "npm-manifest.json"), {
        schemaVersion: 1,
        ...expectedIdentity(),
        workspace: env("PACKAGE_DIRECTORY"),
        filename,
        name: packed["name"],
        version,
        integrity,
    });
}

async function retainedNpm(directory: string): Promise<NpmManifest> {
    const saved = await readJson(join(directory, "npm-manifest.json"));
    const identity = checkIdentity(saved);
    const filename = npmFilename(saved["filename"]);
    const version = releaseVersion(identity.tag, env("TAG_PREFIX", "v"));
    const integrity = await npmIntegrity(directory, filename);
    const workspace = env("PACKAGE_DIRECTORY");
    assert(
        saved["schemaVersion"] === 1 &&
            saved["workspace"] === workspace &&
            typeof saved["name"] === "string" &&
            saved["name"].length > 0 &&
            saved["version"] === version &&
            saved["integrity"] === integrity,
        "Retained npm tarball does not match its manifest"
    );
    return { schemaVersion: 1, ...identity, workspace, filename, name: saved["name"], version, integrity };
}

async function checkNpm(directory: string, waitForPublication: boolean): Promise<void> {
    const manifest = await retainedNpm(directory);
    await output("filename", manifest.filename);
    const deadline = Date.now() + 120_000;
    for (;;) {
        const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
            { redirect: "error", signal: AbortSignal.timeout(60_000) }
        );
        if (response.status === 404 && !waitForPublication) {
            await response.body?.cancel();
            await output("published", "false");
            return;
        }
        if (waitForPublication && (response.status === 404 || response.status >= 500)) {
            await response.body?.cancel();
            assert(
                Date.now() < deadline,
                "Published npm package is not yet available; retry verification with the retained artifact"
            );
            await delay(5_000);
            continue;
        }
        assert(response.ok, `npm registry returned HTTP ${response.status}`);
        const published = (await response.json()) as {
            name?: unknown;
            version?: unknown;
            dist?: { integrity?: unknown };
        };
        assert(
            published.name === manifest.name &&
                published.version === manifest.version &&
                published.dist?.integrity === manifest.integrity,
            "Registry package differs from the retained tarball"
        );
        await output("published", "true");
        if (waitForPublication)
            await writeJson(join(directory, "npm-verification.json"), { ...manifest, verified: true });
        console.log(`Verified ${manifest.name}@${manifest.version}`);
        return;
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command || (command === "--help" && args.length === 1)) {
        console.log(`allurx-build release helpers: ${commands.join(" | ")}`);
        return;
    }

    // 发布命令没有额外选项，必须在读取产物或发出请求前拒绝误写参数。
    assert(args.length === 1, "Expected exactly one release command, without additional arguments");
    assert(commands.includes(command), `Unknown release command: ${command}`);
    if (command === "check-tag") return checkTag();

    const directory = resolve(env("RELEASE_DIR"));
    await mkdir(directory, { recursive: true });
    if (command === "npm-inspect") return inspectNpm(directory);
    if (command === "npm-check" || command === "npm-verify") return checkNpm(directory, command === "npm-verify");
    if (command === "npm-github-release") {
        const manifest = await retainedNpm(directory);
        const url = await publishGithubRelease({ directory, ...manifest, ...githubReleaseOptions() });
        await output("release-url", url);
        console.log(`Verified GitHub Release: ${url}`);
        return;
    }

    const bundle = join(directory, "bundle.zip");
    if (command === "inspect") {
        const manifest = await inspectBundle(bundle);
        await verifySignatures(bundle, env("GPG_FINGERPRINT").replaceAll(" ", "").toUpperCase(), env("GNUPGHOME"));
        await writeJson(join(directory, "manifest.json"), {
            ...manifest,
            repository: env("GITHUB_REPOSITORY"),
            tag: env("RELEASE_TAG"),
            commit: await run("git", ["rev-parse", "HEAD"]),
            workflowSha: env("SHARED_WORKFLOW_SHA"),
        });
        return;
    }

    const manifest = await retainedBundle(directory);
    if (command === "github-release") {
        const url = await publishGithubRelease({
            directory,
            ...expectedIdentity(),
            bundleSha256: manifest.bundleSha256,
            fileCount: manifest.files.length,
            ...githubReleaseOptions(),
        });
        await output("release-url", url);
        console.log(`Verified GitHub Release: ${url}`);
        return;
    }
    if (command === "verify") {
        await verifyPublic(manifest);
        await writeJson(join(directory, "public-verification.json"), {
            verified: true,
            bundleSha256: manifest.bundleSha256,
            files: manifest.files.length,
        });
        return;
    }

    const authorization = `Bearer ${Buffer.from(`${env("CENTRAL_USERNAME")}:${env("CENTRAL_PASSWORD")}`).toString("base64")}`;
    const deploymentName = `${env("GITHUB_REPOSITORY").replace("/", "-")}-${env("RELEASE_TAG")}`;
    const publicationPath = join(directory, "publication.json");
    let deploymentId = env("DEPLOYMENT_ID", "");
    if (command === "upload") {
        assert(
            env("GITHUB_RUN_ATTEMPT", "1") === "1" || env("UPLOAD_RETRY_ALLOWED", "") === "true",
            "Upload is disabled on reruns without workflow authorization; recover using the original deployment ID"
        );
        assert(!deploymentId, "Recovery must use status, never upload");
        // 发送字节前记录结果未知；已有记录可能对应已被接受的上传，不能覆盖。
        await writeFile(
            publicationPath,
            JSON.stringify({ state: "UPLOAD_STATUS_UNKNOWN", deploymentName, bundleSha256: manifest.bundleSha256 }) +
                "\n",
            { flag: "wx" }
        );
        const form = new FormData();
        form.set(
            "bundle",
            new Blob([Uint8Array.from(await readFile(bundle))], { type: "application/octet-stream" }),
            "bundle.zip"
        );
        const url = new URL(`${central}/upload`);
        url.searchParams.set("name", deploymentName);
        url.searchParams.set("publishingType", "AUTOMATIC");
        const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: authorization },
            body: form,
            redirect: "error",
            signal: AbortSignal.timeout(300_000),
        });
        assert(response.ok, `Central upload returned HTTP ${response.status}; inspect Central before retrying`);
        deploymentId = (await response.text()).trim();
        assert(uuid.test(deploymentId), "Central did not return a deployment ID; inspect Central before retrying");
        await writeJson(publicationPath, {
            deploymentId,
            deploymentName,
            state: "UPLOADED",
            bundleSha256: manifest.bundleSha256,
        });
        await output("deployment-id", deploymentId);
        console.log(`Central deployment: ${deploymentId}`);
    }

    assert(uuid.test(deploymentId), "A valid deployment ID is required");
    const deadline = Date.now() + 30 * 60_000;
    for (;;) {
        const response = await fetch(`${central}/status?id=${deploymentId}`, {
            method: "POST",
            headers: { Authorization: authorization },
            redirect: "error",
            signal: AbortSignal.timeout(60_000),
        });
        assert(response.ok, `Central status returned HTTP ${response.status}; retain deployment ${deploymentId}`);
        const state = (await response.json()) as {
            deploymentId?: string;
            deploymentName?: string;
            deploymentState?: string;
        };
        assert(
            state.deploymentId === deploymentId && state.deploymentName === deploymentName && state.deploymentState,
            "Central deployment identity does not match the retained release"
        );
        await writeJson(publicationPath, { ...state, bundleSha256: manifest.bundleSha256 });
        if (state.deploymentState === "PUBLISHED") return;
        assert(
            ["PENDING", "VALIDATING", "PUBLISHING"].includes(state.deploymentState),
            `Central deployment is ${state.deploymentState}: ${deploymentId}`
        );
        assert(Date.now() < deadline, `Central publication is still pending: ${deploymentId}`);
        await delay(10_000);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Release helper failed");
        process.exitCode = 1;
    });
}
