import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { asArray, asObject, assert, download, env, int, request, str, type JsonObject } from './util.js';

export function validateTag(tag: string): string {
  assert(tag === tag.trim() && /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag), 'A stable vMAJOR.MINOR.PATCH tag is required');
  return tag.slice(1);
}

export function createGithub(repository = env('GITHUB_REPOSITORY'), token = env('GH_TOKEN', '') || env('GITHUB_TOKEN', '')) {
  assert(repository === repository.trim() && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid GitHub repository');
  const root = `https://api.github.com/repos/${repository}`;

  async function call(path: string, method = 'GET', body?: JsonObject | Uint8Array, missing = false, binary = false): Promise<unknown> {
    const url = new URL(path.startsWith('https://') ? path : root + path);
    assert(url.protocol === 'https:' && ['api.github.com', 'uploads.github.com'].includes(url.hostname)
      && !url.username && !url.password && !url.port, 'Unexpected authenticated GitHub endpoint');
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'allurx-build', 'X-GitHub-Api-Version': '2026-03-10' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = body instanceof Uint8Array ? 'application/octet-stream' : 'application/json';
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body instanceof Uint8Array ? Uint8Array.from(body).buffer : JSON.stringify(body);
    const response = await request(url.href, init);
    if (response.status === 404 && missing) { await response.body?.cancel(); return null; }
    if (response.status === 302 && binary) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      assert(location, 'Artifact download redirect is missing');
      return download(location);
    }
    assert(response.ok, `GitHub API ${method} failed with HTTP ${response.status}`);
    return binary ? new Uint8Array(await response.arrayBuffer()) : response.json() as Promise<unknown>;
  }

  async function get(path: string): Promise<JsonObject> { return asObject(await call(path)); }
  async function optional(path: string): Promise<JsonObject | null> {
    const result = await call(path, 'GET', undefined, true);
    return result === null ? null : asObject(result);
  }
  async function post(path: string, body: JsonObject): Promise<JsonObject> { return asObject(await call(path, 'POST', body)); }
  async function upload(path: string, body: Uint8Array): Promise<JsonObject> { return asObject(await call(path, 'POST', body)); }

  async function pages(path: string, key?: string): Promise<JsonObject[]> {
    const result: JsonObject[] = [];
    for (let page = 1; ; page++) {
      const response = await call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (key === 'workflow_runs') assert(int(asObject(response), 'total_count') <= 1000,
        "Workflow history exceeds GitHub's 1000 filtered-run limit; manual review is required");
      const values = asArray(key ? asObject(response)[key] : response).map(asObject);
      result.push(...values);
      if (values.length < 100) return result;
    }
  }

  async function tag(name: string): Promise<JsonObject> {
    validateTag(name);
    const reference = asObject((await get(`/git/ref/tags/${name}`)).object);
    assert(str(reference, 'type') === 'tag', 'Release requires an annotated tag');
    const annotation = await get(`/git/tags/${str(reference, 'sha')}`);
    const commit = asObject(annotation.object);
    assert(str(commit, 'type') === 'commit', 'Annotated tag must directly reference a commit');
    return { tag: name, tagObject: str(reference, 'sha'), commit: str(commit, 'sha') };
  }

  function ciMatches(run: JsonObject, commit: string): boolean {
    return str(run, 'event') === 'push' && str(run, 'head_branch') === 'main'
      && str(run, 'head_sha') === commit && str(run, 'path') === '.github/workflows/ci.yml';
  }

  async function exactCi(commit: string): Promise<JsonObject> {
    const matches = (await pages(`/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${encodeURIComponent(commit)}`, 'workflow_runs'))
      .filter(value => ciMatches(value, commit)).sort((a, b) => int(b, 'id') - int(a, 'id'));
    assert(matches.length, 'No main push CI run exists for the exact release commit');
    const id = int(matches[0]!, 'id');
    const current = await get(`/actions/runs/${id}`);
    const number = int(current, 'run_attempt');
    const attempt = await get(`/actions/runs/${id}/attempts/${number}`);
    assert(int(current, 'id') === id && int(attempt, 'id') === id && int(attempt, 'run_attempt') === number
      && ciMatches(attempt, commit) && str(attempt, 'status') === 'completed' && str(attempt, 'conclusion') === 'success',
    'Latest exact-commit main CI attempt is not completed/success');
    return { runId: id, attempt: number, url: str(attempt, 'html_url') };
  }

  async function noPreviousDeploy(run: number, attempt: number): Promise<void> {
    for (let previous = 1; previous < attempt; previous++) {
      const steps = (await pages(`/actions/runs/${run}/attempts/${previous}/jobs`, 'jobs'))
        .flatMap(job => asArray(job.steps ?? []).map(asObject))
        .filter(step => str(step, 'name') === 'Deploy once and wait for publication');
      assert(steps.length === 1 && str(steps[0]!, 'conclusion') === 'skipped',
        'A previous deploy was entered or cannot be ruled out; inspect the existing deployment and evidence without redeploying');
    }
  }

  async function noDuplicateRun(run: number, tag: string, commit: string): Promise<void> {
    for (const previous of await pages('/actions/workflows/release.yml/runs?event=push', 'workflow_runs')) {
      const id = int(previous, 'id');
      if (id === run || (str(previous, 'head_branch') !== tag && str(previous, 'head_sha') !== commit)) continue;
      const current = await get(`/actions/runs/${id}`);
      assert(str(current, 'status') === 'completed', 'Another publish run for this release is not completed');
      await noPreviousDeploy(id, int(current, 'run_attempt') + 1);
    }
  }

  async function artifact(run: number, name: string, target: string): Promise<void> {
    const matches = (await pages(`/actions/runs/${run}/artifacts`, 'artifacts')).filter(value => str(value, 'name') === name);
    assert(matches.length === 1 && matches[0]!.expired === false, `Required unique, unexpired artifact is unavailable: ${name}`);
    const archive = await call(`/actions/artifacts/${int(matches[0]!, 'id')}/zip`, 'GET', undefined, false, true);
    assert(archive instanceof Uint8Array, 'Expected an artifact archive');
    await extractArtifact(archive, target);
  }

  return { repository, get, optional, post, upload, pages, tag, exactCi, artifact, noPreviousDeploy, noDuplicateRun };
}

export async function extractArtifact(archive: Uint8Array, target: string): Promise<void> {
  checkArchive(archive);
  const root = resolve(target), names = new Set<string>();
  // fflate's filter sees every central-directory entry before duplicate names can be collapsed.
  const files = unzipSync(archive, { filter(entry) {
    const parts = entry.name.replace(/\/$/, '').split('/');
    assert(parts.every(part => part && part !== '.' && part !== '..' && part !== '__proto__' && !/[\\:\x00-\x1f<>"|?*]/.test(part)
      && !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(part)), 'Unsafe artifact path');
    const name = entry.name.replace(/\/$/, '').toLowerCase();
    assert(!names.has(name), 'Duplicate artifact archive entry'); names.add(name);
    return true;
  } });
  for (const [name, content] of Object.entries(files)) {
    const destination = resolve(root, name), subpath = relative(root, destination);
    assert(subpath && subpath !== '..' && !subpath.startsWith('..' + sep) && !isAbsolute(subpath), 'Unsafe artifact destination');
    for (let parent = destination; ; parent = dirname(parent)) {
      try { assert(!(await lstat(parent)).isSymbolicLink(), 'Artifact destination contains a symbolic link'); }
      catch (error) { if (!isMissing(error)) throw error; }
      if (dirname(parent) === parent) break;
    }
    if (name.endsWith('/')) await mkdir(destination, { recursive: true });
    else { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, content, { flag: 'wx' }); }
  }
}

// fflate does not expose Unix file attributes. Inspect them before any file is written.
function checkArchive(archive: Uint8Array): void {
  const data = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const min = Math.max(0, archive.length - 65_557);
  let end = archive.length - 22;
  while (end >= min && !(data.getUint32(end, true) === 0x06054b50
    && end + 22 + data.getUint16(end + 20, true) === archive.length)) end--;
  assert(end >= min, 'Invalid artifact ZIP directory');
  const count = data.getUint16(end + 10, true);
  let position = data.getUint32(end + 16, true);
  assert(count !== 65_535 && data.getUint16(end + 4, true) === 0 && data.getUint16(end + 6, true) === 0,
    'Split and ZIP64 artifact archives are unsupported');
  assert(data.getUint16(end + 8, true) === count && data.getUint32(end + 12, true) === end - position,
    'Invalid artifact ZIP directory size/count');
  for (let index = 0; index < count; index++) {
    assert(position + 46 <= end && data.getUint32(position, true) === 0x02014b50, 'Invalid artifact ZIP entry');
    assert(((data.getUint32(position + 38, true) >>> 16) & 0o170000) !== 0o120000, 'Artifact archive contains a symbolic link');
    position += 46 + data.getUint16(position + 28, true) + data.getUint16(position + 30, true) + data.getUint16(position + 32, true);
  }
  assert(position === end, 'Invalid artifact ZIP directory size');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
