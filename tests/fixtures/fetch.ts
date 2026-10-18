/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";

export interface PlannedResponse {
    status?: number;
    json?: unknown;
    error?: string;
    text?: string;
    base64?: string;
}

export interface RequestLog {
    url: string;
    method: string;
    bundleName?: string;
    bundleSize?: number;
}

const planPath = process.env["FETCH_PLAN"];
const callsPath = process.env["FETCH_CALLS"];
assert.ok(planPath && callsPath, "The fetch fixture requires isolated plan and request log paths");
const plan = JSON.parse(readFileSync(planPath, "utf8")) as PlannedResponse[];

// 每次 CLI 调用都在独立进程中使用预设响应，意外请求立即失败且不会访问网络。
globalThis.fetch = async (input, options = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const request: RequestLog = { url, method: options.method ?? "GET" };
    if (options.body instanceof FormData) {
        const bundle = options.body.get("bundle");
        assert.ok(bundle instanceof File);
        request.bundleName = bundle.name;
        request.bundleSize = bundle.size;
    }
    await appendFile(callsPath, JSON.stringify(request) + "\n");

    const next = plan.shift();
    if (!next) throw new Error("Unexpected network request: " + url);
    if (next.error) throw new Error(next.error);
    if (Object.hasOwn(next, "json")) return Response.json(next.json, { status: next.status ?? 200 });
    return new Response(next.base64 ? Buffer.from(next.base64, "base64") : (next.text ?? null), {
        status: next.status ?? 200,
    });
};
