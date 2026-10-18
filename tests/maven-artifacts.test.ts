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
import { zipSync, strToU8 } from "fflate";
import { inspectBundle, verifyPublic } from "../src/maven-artifacts.ts";
import { releaseVersion } from "../src/release.ts";

const path = "io/allurx/example/1.0.0/example-1.0.0.pom";
const pom = strToU8("<project><modelVersion>4.0.0</modelVersion></project>");
const signature = strToU8("signature validated separately by GPG");
const checksum = strToU8(createHash("sha256").update(pom).digest("hex"));
const entries = (): Record<string, Uint8Array<ArrayBuffer>> => ({
    [path]: pom,
    [`${path}.asc`]: signature,
    [`${path}.sha256`]: checksum,
});

async function bundle(t: TestContext, files = entries()) {
    const directory = await mkdtemp(join(tmpdir(), "allurx-bundle-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "bundle.zip");
    await writeFile(file, zipSync(files));
    return file;
}

await test("inspect the actual POM-only bundle without requiring a JAR", async (t) => {
    const manifest = await inspectBundle(await bundle(t));
    assert.equal(manifest.files.length, 3);
    assert.match(manifest.bundleSha256, /^[0-9a-f]{64}$/);
});

await test("reject corrupt checksums and missing signatures", async (t) => {
    await assert.rejects(
        inspectBundle(await bundle(t, { ...entries(), [`${path}.sha256`]: strToU8("0".repeat(64)) })),
        /Invalid checksum/
    );
    await assert.rejects(inspectBundle(await bundle(t, { [path]: pom })), /Missing signature/);
});

await test("reject bundle paths that could address another resource", async (t) => {
    await assert.rejects(inspectBundle(await bundle(t, { ...entries(), "../escape.pom": pom })), /Unsafe bundle path/);
});

await test("verify every public file against retained bytes", async (t) => {
    const manifest = await inspectBundle(await bundle(t));
    const files = entries();
    const visited: string[] = [];
    await verifyPublic(
        manifest,
        (url) => {
            const name = new URL(url instanceof Request ? url.url : url).pathname.slice("/maven2/".length);
            visited.push(name);
            assert.ok(files[name], `Unexpected artifact request: ${name}`);
            return Promise.resolve(new Response(files[name]));
        },
        0
    );
    assert.deepEqual(visited.sort(), Object.keys(files).sort());
});

await test("public verification rejects changed bytes and missing files", async (t) => {
    const manifest = await inspectBundle(await bundle(t));
    await assert.rejects(
        verifyPublic(manifest, () => Promise.resolve(new Response("changed")), 0),
        /differs/
    );
    await assert.rejects(
        verifyPublic(manifest, () => Promise.resolve(new Response(null, { status: 404 })), 0),
        /not yet available/
    );
});

await test("release tags support independent components but reject ambiguous versions", () => {
    assert.equal(releaseVersion("v1.2.3", "v"), "1.2.3");
    assert.equal(releaseVersion("maven-parent-v2.0.0", "maven-parent-v"), "2.0.0");
    for (const tag of ["v01.2.3", "v1.2.3-SNAPSHOT", "v1.2.3 extra", "anything"]) {
        assert.throws(() => releaseVersion(tag, "v"));
    }
});
