import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, writeSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

export type JsonObject = Record<string, unknown>;

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function asObject(value: unknown): JsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object');
  return value as JsonObject;
}

export function asArray(value: unknown): unknown[] {
  assert(Array.isArray(value), 'Expected a JSON array');
  return value;
}

export function str(value: JsonObject, key: string): string {
  const field = value[key];
  if (field === undefined || field === null) return '';
  assert(typeof field === 'string', `Expected a string: ${key}`);
  return field;
}

export function int(value: JsonObject, key: string): number {
  const field = value[key];
  assert(typeof field === 'number' && Number.isSafeInteger(field), `Expected an integer: ${key}`);
  return field;
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  assert(value !== undefined && (fallback !== undefined || value.length > 0), `Required environment variable is missing: ${name}`);
  return value;
}

export async function readJson(path: string): Promise<JsonObject> {
  return asObject(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const hash = createHash('sha256');
  if (typeof value === 'string') for await (const chunk of createReadStream(value)) hash.update(chunk);
  else hash.update(value);
  return hash.digest('hex');
}

function redact(value: string): string {
  for (const name of ['CENTRAL_USERNAME', 'CENTRAL_PASSWORD', 'MAVEN_GPG_PASSPHRASE', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const secret = process.env[name];
    if (secret) value = value.replaceAll(secret, '[REDACTED]');
  }
  return value;
}

function launch(command: string, args: string[]) {
  // Windows Maven ships as a batch file; reject shell syntax before invoking cmd.
  if (process.platform === 'win32' && /^mvn(?:\.cmd)?$/i.test(command)) {
    assert(args.every(value => !/[\r\n\0"&|<>^%!]/.test(value)), 'Unsafe Windows Maven argument');
    const quoted = args.map(value => `"${value}"`).join(' ');
    return spawn(env('ComSpec', 'cmd.exe'), ['/d', '/s', '/c', `mvn.cmd ${quoted}`],
      { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function run(command: string, args: string[] = []): Promise<string> {
  const child = launch(command, args);
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert(code === 0, `${command} failed (${code ?? 'signal'}): ${redact(stderr || stdout).slice(-2000)}`);
  return stdout.trim();
}

export async function stream(log: string, command: string, args: string[]): Promise<number> {
  await mkdir(dirname(log), { recursive: true });
  const file = openSync(log, 'w');
  try {
    const child = launch(command, args);
    const completion = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
    const readers = [child.stdout, child.stderr].map(async input => {
      for await (const line of createInterface({ input, crlfDelay: Infinity })) {
        const safe = redact(line);
        writeSync(file, safe + '\n');
        console.log(safe);
      }
    });
    const [code] = await Promise.all([completion, ...readers]);
    return code;
  } finally { closeSync(file); }
}

export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(60_000);
  return fetch(url, { ...init, redirect: 'manual', signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}

// Signed storage downloads are anonymous, including every subsequent HTTPS redirect.
export async function download(url: string): Promise<Uint8Array> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const endpoint = new URL(url);
    assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password, 'Download must use HTTPS without credentials');
    const response = await request(url, { headers: { 'User-Agent': 'allurx-build' } });
    if (response.status === 200) return new Uint8Array(await response.arrayBuffer());
    await response.body?.cancel();
    const location = response.headers.get('location');
    assert([301, 302, 303, 307, 308].includes(response.status) && location, `Download failed with HTTP ${response.status}`);
    url = new URL(location, endpoint).href;
  }
  throw new Error('Download exceeded redirect limit');
}

export async function output(name: string, value: string): Promise<void> {
  assert(/^[a-zA-Z0-9_-]+$/.test(name) && !/[\r\n]/.test(value), 'Invalid workflow output');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
