/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assert, readJson } from "./util.ts";

interface Release {
    id: number;
    tag_name: string;
    body: string | null;
    draft: unknown;
    prerelease: unknown;
    immutable: unknown;
    html_url: string;
}

type CheckedRelease = Release & { draft: boolean; prerelease: false; immutable: boolean };

interface Asset {
    name: string;
    size: number;
    digest: string | null;
    state: string;
}

interface ReleaseIdentity {
    directory: string;
    repository: string;
    tag: string;
    commit: string;
    token: string;
    releaseId?: number;
    allowCreate?: boolean;
}

type ReleaseEvidence = ReleaseIdentity &
    ({ bundleSha256: string; fileCount: number } | { name: string; version: string; integrity: string });

/**
 * 为已通过公开核验的 Maven 或 npm 原始产物完成 GitHub Release，重试时复用已有状态。
 */
export async function publishGithubRelease(evidence: ReleaseEvidence, fetcher = fetch): Promise<string> {
    const { directory, repository, tag, commit } = evidence;
    assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "Invalid GitHub repository");
    assert(
        evidence.releaseId === undefined || (Number.isSafeInteger(evidence.releaseId) && evidence.releaseId > 0),
        "Expected a positive GitHub Release ID"
    );
    let publication: { bundleSha256: string } | { name: string; version: string; integrity: string };
    let attachmentNames: string[];
    if ("bundleSha256" in evidence) {
        const verification = await readJson(join(directory, "public-verification.json"));
        assert(
            verification["verified"] === true &&
                verification["bundleSha256"] === evidence.bundleSha256 &&
                verification["files"] === evidence.fileCount,
            "Matching public artifact verification is required before creating a Release"
        );
        publication = { bundleSha256: evidence.bundleSha256 };
        attachmentNames = ["manifest.json", "public-verification.json", "signing-public-key.asc"];
    } else {
        const manifest = await readJson(join(directory, "npm-manifest.json"));
        const verification = await readJson(join(directory, "npm-verification.json"));
        publication = { name: evidence.name, version: evidence.version, integrity: evidence.integrity };
        assert(
            manifest["schemaVersion"] === 1 &&
                Object.entries({ repository, tag, commit, ...publication }).every(
                    ([key, value]) => manifest[key] === value
                ) &&
                isDeepStrictEqual(verification, { ...manifest, verified: true }),
            "Matching npm registry verification is required before creating a Release"
        );
        attachmentNames = ["npm-manifest.json", "npm-verification.json"];
    }

    // 只公开核验证据；原始 bundle、tarball 和构建日志继续保存在 workflow artifact 中。
    const attachments = await Promise.all(
        attachmentNames.map(async (name) => {
            const data = await readFile(join(directory, name));
            return {
                name,
                data,
                size: data.length,
                digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
            };
        })
    );
    const marker = `<!-- allurx-build ${JSON.stringify({ repository, tag, commit, ...publication })} -->`;
    const root = `https://api.github.com/repos/${repository}`;

    async function request(path: string, method = "GET", body?: object | Uint8Array, upload = false): Promise<unknown> {
        const headers: Record<string, string> = {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${evidence.token}`,
            "User-Agent": "allurx-build",
            "X-GitHub-Api-Version": "2026-03-10",
        };
        const options: RequestInit = { method, headers, redirect: "error", signal: AbortSignal.timeout(60_000) };
        if (body !== undefined) {
            headers["Content-Type"] = body instanceof Uint8Array ? "application/octet-stream" : "application/json";
            options.body = body instanceof Uint8Array ? Uint8Array.from(body) : JSON.stringify(body);
        }
        const base = upload ? `https://uploads.github.com/repos/${repository}` : root;
        const response = await fetcher(base + path, options);
        assert(
            response.ok,
            `GitHub ${method} ${path} returned HTTP ${response.status}; retain the existing Release and retry after checking its state`
        );
        return response.json();
    }

    async function pages<T>(path: string): Promise<T[]> {
        const result: T[] = [];
        for (let page = 1; ; page++) {
            const values = (await request(`${path}?per_page=100&page=${page}`)) as T[];
            assert(Array.isArray(values), "GitHub returned an invalid paginated response");
            result.push(...values);
            if (values.length < 100) return result;
        }
    }

    async function checkRemoteTag(): Promise<void> {
        const reference = (await request(`/git/ref/tags/${encodeURIComponent(tag)}`)) as {
            object: { type: string; sha: string };
        };
        assert(reference.object.type === "tag", "GitHub Release requires an annotated tag");
        const annotation = (await request(`/git/tags/${reference.object.sha}`)) as {
            object: { type: string; sha: string };
        };
        assert(
            annotation.object.type === "commit" && annotation.object.sha === commit,
            "Remote release tag no longer matches the verified commit"
        );
    }

    function checkRelease(release: Release): asserts release is CheckedRelease {
        assert(
            Number.isSafeInteger(release.id) &&
                release.id > 0 &&
                release.tag_name === tag &&
                typeof release.draft === "boolean" &&
                typeof release.immutable === "boolean" &&
                release.prerelease === false &&
                typeof release.body === "string" &&
                release.body.includes(marker),
            "Existing GitHub Release identity differs; its body and attachments were not overwritten"
        );
    }

    function missingAttachments(assets: Asset[]) {
        return attachments.filter((expected) => {
            const matching = assets.filter((asset) => asset.name === expected.name);
            if (!matching.length) return true;
            const [asset] = matching;
            assert(
                matching.length === 1 &&
                    asset?.state === "uploaded" &&
                    asset.size === expected.size &&
                    asset.digest === expected.digest,
                `Existing Release asset differs or has no matching digest: ${expected.name}`
            );
            return false;
        });
    }

    await checkRemoteTag();
    // 新建草稿可能尚未出现在列表中；已知 ID 直接读取，不能因 404 或身份不符另建一份。
    let release: Release | undefined;
    if (evidence.releaseId !== undefined) {
        release = (await request(`/releases/${evidence.releaseId}`)) as Release;
        checkRelease(release);
        assert(release.id === evidence.releaseId, "GitHub returned a different Release ID");
    }
    const matches = (await pages<Release>("/releases")).filter((release) => release.tag_name === tag);
    assert(
        matches.length <= 1 && matches.every((match) => !release || match.id === release.id),
        "Multiple Releases use this tag; inspect them without overwriting either"
    );
    release ??= matches[0];
    if (!release) {
        // 列表暂空不能证明之前没有创建成功；只有发布控制器明确授权首次创建时才发送 POST。
        assert(
            evidence.allowCreate === true,
            "Release creation is not authorized; retry recovery after checking GitHub or supply GITHUB_RELEASE_ID"
        );
        release = (await request("/releases", "POST", {
            tag_name: tag,
            target_commitish: commit,
            name: tag.replace(/-v(?=\d+\.\d+\.\d+$)/, " v"),
            body: `${marker}\n\n`,
            generate_release_notes: true,
            draft: true,
            prerelease: false,
        })) as Release;
    }
    checkRelease(release);
    // 后续上传失败时，日志中的准确 ID 可直接用于恢复，不依赖列表即时可见。
    console.log(`GitHub Release ID: ${release.id}`);

    // 先检查全部已有附件，避免发现冲突前已写入其他附件。
    const missing = missingAttachments(await pages<Asset>(`/releases/${release.id}/assets`));
    assert(
        !missing.length || !release.immutable,
        "The immutable Release is missing required attachments; they cannot be added or replaced"
    );
    for (const attachment of missing) {
        const uploaded = (await request(
            `/releases/${release.id}/assets?name=${encodeURIComponent(attachment.name)}`,
            "POST",
            attachment.data,
            true
        )) as Asset;
        assert(
            uploaded.name === attachment.name &&
                uploaded.state === "uploaded" &&
                uploaded.size === attachment.size &&
                uploaded.digest === attachment.digest,
            `Uploaded Release asset does not match the retained evidence: ${attachment.name}`
        );
    }

    if (missing.length) {
        assert(
            !missingAttachments(await pages<Asset>(`/releases/${release.id}/assets`)).length,
            "GitHub did not retain all required Release attachments"
        );
    }
    if (release.draft) {
        // 发布时只改变草稿状态，保留自动生成或后来编辑的说明。
        release = (await request(`/releases/${release.id}`)) as Release;
        checkRelease(release);
        await checkRemoteTag();
        if (release.draft) {
            assert(!release.immutable, "The existing draft is immutable and cannot be published");
            await request(`/releases/${release.id}`, "PATCH", { draft: false, make_latest: "legacy" });
        }
        release = (await request(`/releases/${release.id}`)) as Release;
        checkRelease(release);
        assert(!release.draft, "GitHub Release is still a draft");
        assert(
            !missingAttachments(await pages<Asset>(`/releases/${release.id}/assets`)).length,
            "Published Release is missing required attachments"
        );
    }
    return release.html_url;
}
