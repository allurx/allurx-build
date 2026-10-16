import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { verifySignatures } from "../src/maven-artifacts.ts";
import { run } from "../src/util.ts";

await test("GPG verification checks the actual signer and rejects modified artifact bytes", async (t) => {
    // 保持临时 GNUPGHOME 路径较短，兼容 Windows GnuPG 和 Unix socket 的路径限制。
    const keyring = await mkdtemp(join(tmpdir(), "ag-"));
    await chmod(keyring, 0o700);
    t.after(async () => {
        try {
            await run("gpgconf", ["--homedir", keyring, "--kill", "gpg-agent"]);
        } finally {
            await rm(keyring, { recursive: true, force: true });
        }
    });
    await run("gpg", [
        "--batch",
        "--homedir",
        keyring,
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        "",
        "--quick-generate-key",
        "Allurx disposable test <release-test@example.invalid>",
        "ed25519",
        "sign",
        "0",
    ]);
    const listing = await run("gpg", ["--batch", "--homedir", keyring, "--with-colons", "--list-keys"]);
    const fingerprint = listing
        .split("\n")
        .find((line) => line.startsWith("fpr:"))
        ?.split(":")[9];
    assert.ok(fingerprint);
    assert.match(fingerprint, /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/);

    const body = strToU8("<project><modelVersion>4.0.0</modelVersion></project>");
    const artifact = join(keyring, "artifact.pom");
    const signature = `${artifact}.asc`;
    await writeFile(artifact, body);
    await run("gpg", [
        "--batch",
        "--homedir",
        keyring,
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        "",
        "--armor",
        "--local-user",
        fingerprint,
        "--output",
        signature,
        "--detach-sign",
        artifact,
    ]);
    const name = "io/allurx/fixture/1.0.0/fixture-1.0.0.pom";
    const bundle = join(keyring, "bundle.zip");
    await writeFile(bundle, zipSync({ [name]: body, [`${name}.asc`]: await readFile(signature) }));

    await verifySignatures(bundle, fingerprint, keyring);
    await assert.rejects(verifySignatures(bundle, "0".repeat(40), keyring), /Unexpected signer/);

    await writeFile(
        bundle,
        zipSync({ [name]: strToU8("modified artifact"), [`${name}.asc`]: await readFile(signature) })
    );
    await assert.rejects(verifySignatures(bundle, fingerprint, keyring), /gpg failed/);
});
