/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

interface ReleaseEvidence {
    directory: string;
    repository: string;
    tag: string;
    version: string;
    commit: string;
    bundleSha256: string;
    fileCount: number;
    token: string;
}

/**
 * 为已通过公开核验的原始 Maven bundle 完成 GitHub Release，重试时复用已有状态。
 */
export async function publishGithubRelease(evidence: ReleaseEvidence, fetcher = fetch): Promise<string> {
    const { directory, repository, tag, commit, bundleSha256 } = evidence;
    assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "Invalid GitHub repository");
    const verification = await readJson(join(directory, "public-verification.json"));
    assert(
        verification["verified"] === true &&
            verification["bundleSha256"] === bundleSha256 &&
            verification["files"] === evidence.fileCount,
        "Matching public artifact verification is required before creating a Release"
    );

    // 只公开这些留存附件；原始 bundle 和构建日志继续保存在 workflow artifact 中。
    const attachments = await Promise.all(
        ["manifest.json", "public-verification.json", "signing-public-key.asc"].map(async (name) => {
            const data = await readFile(join(directory, name));
            return {
                name,
                data,
                size: data.length,
                digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
            };
        })
    );
    const marker = `<!-- allurx-build ${JSON.stringify({ repository, tag, commit, bundleSha256 })} -->`;
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
    // 按 tag 查询只能保证找到已发布版本；列表还能找回中断后留下的草稿。
    const matches = (await pages<Release>("/releases")).filter((release) => release.tag_name === tag);
    assert(matches.length <= 1, "Multiple Releases use this tag; inspect them without overwriting either");
    let release = matches[0];
    release ??= (await request("/releases", "POST", {
        tag_name: tag,
        target_commitish: commit,
        name: `v${evidence.version}`,
        body: `${marker}\n\n`,
        generate_release_notes: true,
        draft: true,
        prerelease: false,
    })) as Release;
    checkRelease(release);

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
