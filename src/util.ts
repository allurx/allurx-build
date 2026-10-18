/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

/**
 * 必填环境变量必须非空；显式提供 fallback 时允许空字符串。
 */
export function env(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    assert(
        value !== undefined && (fallback !== undefined || value.length > 0),
        `Missing environment variable: ${name}`
    );
    return value;
}

/**
 * 读取 JSON 对象；具体字段仍由所属业务边界校验。
 */
export async function readJson(path: string): Promise<Record<string, unknown>> {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    assert(value !== null && typeof value === "object" && !Array.isArray(value), `Expected a JSON object: ${path}`);
    return value as Record<string, unknown>;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

/**
 * 不经过 shell 执行命令，成功时返回去除首尾空白的输出，失败时保留末尾诊断。
 */
export async function run(command: string, args: string[]): Promise<string> {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
        stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
    });
    assert(code === 0, `${command} failed (${code ?? "signal"}): ${(stderr || stdout).slice(-2000)}`);
    return stdout.trim();
}
