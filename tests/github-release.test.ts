/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { publishGithubRelease } from "../src/github-release.ts";

interface FixtureRelease {
    id: number;
    tag_name: string;
    body: string;
    draft?: boolean;
    prerelease?: boolean;
    immutable?: boolean;
    html_url: string;
}

interface FixtureState {
    release: FixtureRelease | null;
    assets: { name: string; size: number; digest: string; state: string }[];
    remoteCommit: string;
    requests: { url: string; method: string; body: unknown }[];
    failAfter: "create" | "upload" | "publish" | null;
}

interface CreateReleaseBody {
    tag_name: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    generate_release_notes: boolean;
}

async function fixture(t: TestContext, tag = "v1.0.0") {
    const directory = await mkdtemp(join(tmpdir(), "allurx-github-release-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const evidence = {
        directory,
        repository: "allurx/fixture",
        tag,
        commit: "a".repeat(40),
        bundleSha256: "b".repeat(64),
        fileCount: 2,
        token: "fixture-token",
    };
    const manifest = {
        repository: evidence.repository,
        tag: evidence.tag,
        commit: evidence.commit,
        bundleSha256: evidence.bundleSha256,
    };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(
        join(directory, "public-verification.json"),
        JSON.stringify({ verified: true, bundleSha256: evidence.bundleSha256, files: 2 })
    );
    await writeFile(join(directory, "signing-public-key.asc"), "public signing identity fixture");

    const state: FixtureState = {
        release: null,
        assets: [],
        remoteCommit: evidence.commit,
        requests: [],
        failAfter: null,
    };
    const root = `/repos/${evidence.repository}`;
    const release = () => {
        assert.ok(state.release, "The fake GitHub Release must already exist");
        return state.release;
    };
    const fetcher: typeof fetch = (input, options = {}) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const method = options.method ?? "GET";
        const body: unknown = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
        state.requests.push({ url: url.href, method, body });
        assert.equal(options.redirect, "error");
        assert.equal(new Headers(options.headers).get("Authorization"), "Bearer fixture-token");
        assert.ok(["api.github.com", "uploads.github.com"].includes(url.hostname));

        if (method === "GET" && url.pathname === `${root}/git/ref/tags/${evidence.tag}`) {
            return Promise.resolve(Response.json({ object: { type: "tag", sha: "c".repeat(40) } }));
        }
        if (method === "GET" && url.pathname === `${root}/git/tags/${"c".repeat(40)}`) {
            return Promise.resolve(Response.json({ object: { type: "commit", sha: state.remoteCommit } }));
        }
        if (method === "GET" && url.pathname === `${root}/releases`) {
            return Promise.resolve(Response.json(state.release ? [structuredClone(state.release)] : []));
        }
        if (method === "POST" && url.pathname === `${root}/releases`) {
            assert.equal(state.release, null, "Never create a second Release for an interrupted draft");
            const payload = body as CreateReleaseBody;
            state.release = {
                ...payload,
                id: 17,
                immutable: false,
                html_url: `https://github.com/${evidence.repository}/releases/tag/${evidence.tag}`,
                body: `${payload.body}Generated notes remain intact.`,
            };
            if (state.failAfter === "create") {
                state.failAfter = null;
                throw new Error("connection lost after creating draft");
            }
            return Promise.resolve(Response.json(structuredClone(state.release), { status: 201 }));
        }
        if (method === "GET" && url.pathname === `${root}/releases/17/assets`) {
            return Promise.resolve(Response.json(structuredClone(state.assets)));
        }
        if (
            method === "POST" &&
            url.hostname === "uploads.github.com" &&
            url.pathname === `${root}/releases/17/assets`
        ) {
            assert.equal(release().immutable, false);
            assert.ok(body instanceof Uint8Array);
            const name = url.searchParams.get("name");
            assert.ok(name);
            assert.ok(!state.assets.some((asset) => asset.name === name), "Do not replace an existing attachment");
            const asset = {
                name,
                size: body.byteLength,
                digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
                state: "uploaded",
            };
            state.assets.push(asset);
            if (state.failAfter === "upload") {
                state.failAfter = null;
                throw new Error("connection lost after accepting attachment");
            }
            return Promise.resolve(Response.json(structuredClone(asset), { status: 201 }));
        }
        if (method === "GET" && url.pathname === `${root}/releases/17`)
            return Promise.resolve(Response.json(structuredClone(state.release)));
        if (method === "PATCH" && url.pathname === `${root}/releases/17`) {
            assert.deepEqual(body, { draft: false, make_latest: "legacy" });
            assert.equal(state.assets.length, 3, "All evidence must be present before publishing");
            release().draft = false;
            release().immutable = true;
            if (state.failAfter === "publish") {
                state.failAfter = null;
                throw new Error("connection lost after publishing");
            }
            return Promise.resolve(Response.json(structuredClone(state.release)));
        }
        throw new Error(`Unexpected fake GitHub request: ${method} ${url.href}`);
    };
    return { evidence, state, release, finish: () => publishGithubRelease(evidence, fetcher) };
}

await test("create a draft with generated notes, attach verified evidence, then publish it", async (t) => {
    const f = await fixture(t);
    const url = await f.finish();
    assert.match(url, /releases\/tag\/v1.0.0$/);
    const create = f.state.requests.find(
        (request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/releases")
    );
    assert.ok(create);
    const body = create.body as CreateReleaseBody;
    assert.equal(body.name, "v1.0.0");
    assert.equal(body.draft, true);
    assert.equal(body.generate_release_notes, true);
    for (const value of [f.evidence.repository, f.evidence.tag, f.evidence.commit, f.evidence.bundleSha256])
        assert.ok(body.body.includes(value));
    assert.deepEqual(f.state.assets.map((asset) => asset.name).sort(), [
        "manifest.json",
        "public-verification.json",
        "signing-public-key.asc",
    ]);
    assert.equal(f.release().draft, false);
    assert.match(f.release().body, /Generated notes remain intact/);
});

await test("a component release identifies its component without changing the tag", async (t) => {
    const f = await fixture(t, "maven-parent-v1.0.0");
    await f.finish();
    const create = f.state.requests.find(
        (request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/releases")
    );
    assert.ok(create);
    const body = create.body as CreateReleaseBody;
    assert.equal(body.tag_name, "maven-parent-v1.0.0");
    assert.equal(body.name, "maven-parent v1.0.0");
});

await test("recover a draft after its creation response was lost without creating another Release", async (t) => {
    const f = await fixture(t);
    f.state.failAfter = "create";
    await assert.rejects(f.finish(), /connection lost/);
    assert.equal(f.release().draft, true);
    await f.finish();
    assert.equal(
        f.state.requests.filter(
            (request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/releases")
        ).length,
        1
    );
});

await test("resume after a lost upload response without replacing the accepted attachment", async (t) => {
    const f = await fixture(t);
    f.state.failAfter = "upload";
    await assert.rejects(f.finish(), /connection lost/);
    assert.equal(f.state.assets.length, 1);
    await f.finish();
    const uploads = f.state.requests.filter((request) => new URL(request.url).hostname === "uploads.github.com");
    assert.equal(uploads.length, 3);
    assert.equal(new Set(uploads.map((request) => new URL(request.url).searchParams.get("name"))).size, 3);
});

await test("a completed immutable Release is a read-only success after a lost publish response", async (t) => {
    const f = await fixture(t);
    f.state.failAfter = "publish";
    await assert.rejects(f.finish(), /connection lost/);
    const body = f.release().body;
    f.state.requests.length = 0;
    await f.finish();
    assert.ok(f.state.requests.every((request) => request.method === "GET"));
    assert.equal(f.release().body, body);
});

await test("check all existing attachments before adding a missing one, and preserve conflicts", async (t) => {
    const f = await fixture(t);
    await f.finish();
    f.release().immutable = false;
    (f.state.assets[0] ?? assert.fail("Expected an uploaded asset")).digest = "sha256:different";
    f.state.assets.pop();
    f.state.requests.length = 0;
    await assert.rejects(f.finish(), /asset differs/);
    assert.ok(f.state.requests.every((request) => request.method === "GET"));
});

await test("an immutable Release with missing evidence fails without trying to change it", async (t) => {
    const f = await fixture(t);
    await f.finish();
    f.state.assets.pop();
    f.state.requests.length = 0;
    await assert.rejects(f.finish(), /immutable Release is missing/);
    assert.ok(f.state.requests.every((request) => request.method === "GET"));
});

await test("missing attachments can be added to a matching mutable Release without changing its notes", async (t) => {
    const f = await fixture(t);
    await f.finish();
    f.release().immutable = false;
    f.release().body += "\nMaintainer notes.";
    const body = f.release().body;
    f.state.assets.pop();
    f.state.requests.length = 0;
    await f.finish();
    assert.equal(f.state.requests.filter((request) => request.method === "POST").length, 1);
    assert.ok(!f.state.requests.some((request) => request.method === "PATCH"));
    assert.equal(f.release().body, body);
});

await test("a moved tag or changed identity marker is rejected without mutating the existing Release", async (t) => {
    for (const change of [
        (f: Awaited<ReturnType<typeof fixture>>) => {
            f.state.remoteCommit = "d".repeat(40);
        },
        (f: Awaited<ReturnType<typeof fixture>>) => {
            f.release().body = "Unrelated release notes";
        },
    ]) {
        const f = await fixture(t);
        await f.finish();
        change(f);
        f.state.requests.length = 0;
        await assert.rejects(f.finish(), /verified commit|identity differs/);
        assert.ok(f.state.requests.every((request) => request.method === "GET"));
    }
});

await test("public verification must belong to the retained bundle before any GitHub request", async (t) => {
    const f = await fixture(t);
    await writeFile(
        join(f.evidence.directory, "public-verification.json"),
        JSON.stringify({ verified: true, bundleSha256: "f".repeat(64), files: 2 })
    );
    await assert.rejects(f.finish(), /Matching public artifact verification/);
    assert.deepEqual(f.state.requests, []);
});

await test("missing Release status fields are rejected before any write", async (t) => {
    for (const field of ["draft", "prerelease", "immutable"] as const) {
        const f = await fixture(t);
        await f.finish();
        Reflect.deleteProperty(f.release(), field);
        f.state.requests.length = 0;
        await assert.rejects(f.finish(), /identity differs/);
        assert.ok(f.state.requests.every((request) => request.method === "GET"));
    }
});
