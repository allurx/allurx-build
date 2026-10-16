import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { unzipSync } from "fflate";
import { assert, run } from "./util.ts";

export interface BundleManifest {
    schemaVersion: 1;
    bundleSha256: string;
    files: { path: string; size: number; sha256: string }[];
}

const checksums: Record<string, number> = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };
const digest = (bytes: Uint8Array, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");

/**
 * 检查 Maven 实际暂存文件的路径、校验和及签名配对；POM 语义由 Maven 和 Central 验证。
 */
export async function inspectBundle(path: string): Promise<BundleManifest> {
    const bytes = await readFile(path);
    const names = new Set<string>();
    let total = 0;
    const files = unzipSync(bytes, {
        filter(entry) {
            if (entry.name.endsWith("/")) return false;
            assert(!names.has(entry.name), `Duplicate bundle entry: ${entry.name}`);
            assert(
                /^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(entry.name) &&
                    entry.name.split("/").every((part) => part !== "." && part !== ".."),
                `Unsafe bundle path: ${entry.name}`
            );
            names.add(entry.name);
            total += entry.originalSize;
            assert(total <= 2 * 1024 ** 3, "Bundle expands beyond 2 GiB");
            return true;
        },
    });
    assert(
        Object.keys(files).some((name) => name.endsWith(".pom")),
        "Bundle contains no Maven POM"
    );

    for (const [name, data] of Object.entries(files)) {
        const extension = name.slice(name.lastIndexOf(".") + 1);
        if (extension in checksums) {
            const body = files[name.slice(0, -extension.length - 1)];
            const expected = new TextDecoder().decode(data).trim().toLowerCase();
            assert(
                body && expected.length === checksums[extension] && expected === digest(body, extension),
                `Invalid checksum: ${name}`
            );
        } else if (extension !== "asc") {
            assert(files[`${name}.asc`], `Missing signature: ${name}`);
        } else {
            assert(files[name.slice(0, -4)], `Signature has no artifact: ${name}`);
        }
    }

    return {
        schemaVersion: 1,
        bundleSha256: digest(bytes),
        files: Object.entries(files)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, data]) => ({ path: name, size: data.length, sha256: digest(data) })),
    };
}

/**
 * 对已通过结构检查的 bundle 验证分离签名，并核对明确指定的发布签名身份。
 */
export async function verifySignatures(bundle: string, fingerprint: string, keyring: string): Promise<void> {
    assert(/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint), "Expected a complete GPG fingerprint");
    const files = unzipSync(await readFile(bundle));
    const directory = await mkdtemp(join(tmpdir(), "allurx-signatures-"));
    try {
        for (const [name, signature] of Object.entries(files).filter(([name]) => name.endsWith(".asc"))) {
            const body = files[name.slice(0, -4)];
            assert(body, `Signature has no artifact: ${name}`);
            await writeFile(join(directory, "artifact"), body);
            await writeFile(join(directory, "artifact.asc"), signature);
            const status = await run("gpg", [
                "--batch",
                "--homedir",
                keyring,
                "--status-fd",
                "1",
                "--verify",
                join(directory, "artifact.asc"),
                join(directory, "artifact"),
            ]);
            const valid = status.split("\n").filter((line) => line.startsWith("[GNUPG:] VALIDSIG "));
            const [signatureStatus] = valid;
            assert(
                valid.length === 1 && signatureStatus?.split(" ").includes(fingerprint),
                `Unexpected signer: ${name}`
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

/**
 * 逐文件比对公开字节与原始 bundle，等待 Central 同步尚未可见的文件。
 */
export async function verifyPublic(manifest: BundleManifest, fetcher = fetch, timeoutMs = 600_000): Promise<void> {
    assert(manifest.files.length > 0, "Public verification requires a nonempty artifact manifest");
    const pending = new Map(manifest.files.map((file) => [file.path, file]));
    const deadline = Date.now() + timeoutMs;
    while (pending.size) {
        for (const [path, file] of pending) {
            const url = `https://repo.maven.apache.org/maven2/${path.split("/").map(encodeURIComponent).join("/")}`;
            const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
            if (response.status === 404 || response.status >= 500) {
                await response.body?.cancel();
                continue;
            }
            assert(response.ok, `Public artifact returned HTTP ${response.status}: ${path}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            assert(bytes.length === file.size && digest(bytes) === file.sha256, `Published artifact differs: ${path}`);
            pending.delete(path);
        }
        if (!pending.size) return;
        assert(Date.now() < deadline, `Published files are not yet available: ${[...pending.keys()].join(", ")}`);
        await delay(Math.min(10_000, deadline - Date.now()));
    }
}
