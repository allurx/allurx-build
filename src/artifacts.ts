import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify, isDeepStrictEqual } from 'node:util';
import { crc32 } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { assert } from './util.js';

type Xml = Record<string, unknown>;
type Coordinates = { groupId: string; artifactId: string; version: string };
type Metadata = {
  name: string; description: string; url: string;
  licenses: { name: string; url: string }[];
  developers: { id: string; name: string; email: string; url: string }[];
  scm: { url: string; connection: string; developerConnection: string };
};
export type Module = Coordinates & { packaging: string; bodyPaths: string[]; metadata: Metadata };
export type Model = { schemaVersion: 1; version: string; effectivePomSha256: string; modules: Module[]; bodyCount: number };
export type Manifest = Model & { bundleSha256: string; files: { path: string; size: number; sha256: string; kind: string }[] };

const MAX_FILE = 512 * 1024 * 1024, MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const CHECKSUMS: Record<string, number> = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };
const GAV = ['groupId', 'artifactId', 'version'] as const;
const PUBLIC_REPOSITORY = 'https://repo.maven.apache.org/maven2';
const digest = (data: Uint8Array, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const object = (value: unknown): Xml => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Xml : {};
const values = (node: Xml, path: string): unknown[] => path.split('/').reduce<unknown[]>((nodes, key) => nodes.flatMap(n => list(object(n)[key])), [node]);
const elements = (node: Xml, path: string): Xml[] => values(node, path).map(object);
const text = (node: Xml, path: string, fallback = ''): string => {
  const found = values(node, path);
  assert(found.length <= 1 && (found.length === 0 || typeof found[0] === 'string'), `Expected a scalar XML field: ${path}`);
  return (found[0] as string | undefined)?.trim() || fallback;
};

function xml(data: Uint8Array, label: string): Xml {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
  assert(!source.includes('\0') && !/<!DOCTYPE|<!ENTITY/i.test(source), `DTD/entities or non-UTF8 XML are unsupported: ${label}`);
  const valid = XMLValidator.validate(source);
  assert(valid === true, `Invalid XML: ${label}`);
  return object(new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(source));
}

function releaseVersion(version: string): void {
  assert(version === version.trim() && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version), `Expected a stable MAJOR.MINOR.PATCH release version: ${version}`);
}

function fixedVersion(version: string): void {
  assert(Boolean(version) && version === version.trim() && !/[\s\[\](),*]/.test(version)
    && !version.includes('${') && !/^(?:LATEST|RELEASE)$/i.test(version)
    && !/(?:SNAPSHOT|-\d{8}\.\d{6}-\d+)$/i.test(version), `Expected a fixed non-SNAPSHOT version: ${version}`);
}

function interpolate(value: string, properties: Record<string, string>): string {
  for (let i = 0; i < 20; i++) {
    const expanded = value.replace(/\$\{([^}]+)\}/g, (match: string, key: string) => properties[key] ?? match);
    if (expanded === value) return value;
    value = expanded;
  }
  throw new Error('Cyclic or excessively nested Maven properties');
}

function properties(project: Xml): Record<string, string> {
  assert(values(project, 'properties').length <= 1, 'Duplicate Maven properties blocks');
  return Object.fromEntries(Object.entries(object(project.properties)).map(([key, value]) => {
    assert(typeof value === 'string', `Unsupported Maven property: ${key}`);
    return [key, value.trim()];
  }));
}

function metadata(project: Xml): Metadata {
  return {
    name: text(project, 'name'), description: text(project, 'description'), url: text(project, 'url'),
    licenses: elements(project, 'licenses/license').map(n => ({ name: text(n, 'name'), url: text(n, 'url') })),
    developers: elements(project, 'developers/developer').map(n => ({ id: text(n, 'id'), name: text(n, 'name'), email: text(n, 'email'), url: text(n, 'url') })),
    scm: { url: text(project, 'scm/url'), connection: text(project, 'scm/connection'), developerConnection: text(project, 'scm/developerConnection') },
  };
}

function checkMetadata(meta: Metadata, label: string): void {
  const required = (value: string) => assert(Boolean(value) && !value.includes('${'), `Missing/unresolved POM metadata: ${label}`);
  [meta.name, meta.description, meta.url, ...Object.values(meta.scm)].forEach(required);
  assert(meta.licenses.length > 0 && meta.developers.length > 0, `Missing licenses/developers: ${label}`);
  meta.licenses.forEach(v => [v.name, v.url].forEach(required));
  meta.developers.forEach(v => required(v.name || v.id));
}

function bodyPaths(module: Coordinates & { packaging: string }): string[] {
  for (const coordinate of [module.groupId, module.artifactId]) {
    assert(coordinate === coordinate.trim() && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(coordinate) && coordinate.split('.').every(p => p !== '' && p !== '.' && p !== '..'), `Invalid Maven coordinate: ${coordinate}`);
  }
  fixedVersion(module.version);
  assert(!/[\\/:?#%\x00-\x20\x7f]/.test(module.version) && !['.', '..'].includes(module.version), `Unsafe Maven version path: ${module.version}`);
  const base = `${module.groupId.replaceAll('.', '/')}/${module.artifactId}/${module.version}/${module.artifactId}-${module.version}`;
  assert(['pom', 'jar'].includes(module.packaging), `Unsupported packaging: ${module.packaging}`);
  return module.packaging === 'pom' ? [`${base}.pom`] : [`.pom`, `.jar`, `-sources.jar`, `-javadoc.jar`].map(s => base + s);
}

function checkReleaseConfiguration(project: Xml): void {
  const props = properties(project);
  for (const key of ['maven.deploy.skip', 'maven.source.skip', 'maven.javadoc.skip', 'gpg.skip', 'skipPublishing', 'maven.test.skip', 'skipTests']) {
    assert(!props[key] || ['', 'false'].includes(interpolate(props[key], props).toLowerCase()), `Release may not skip ${key}`);
  }
  for (const plugin of elements(project, 'build/plugins/plugin')) {
    const artifact = text(plugin, 'artifactId');
    for (const config of [...elements(plugin, 'configuration'), ...elements(plugin, 'executions/execution/configuration')]) {
      for (const key of ['skip', 'skipPublishing', 'skipSource', 'skipDeploy', 'ignorePublishedComponents']) {
        assert(['', 'false'].includes(interpolate(text(config, key), props).toLowerCase()), `Release may not enable ${artifact}.${key}`);
      }
      for (const key of ['attach', 'failOnBuildFailure']) {
        assert(['', 'true'].includes(interpolate(text(config, key), props).toLowerCase()), `Release requires ${artifact}.${key}=true`);
      }
      assert(!config.excludeArtifacts || config.excludeArtifacts === '', 'Release may not exclude artifacts');
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit);
        for (const [key, item] of Object.entries(object(value))) {
          if (key === 'classifier') {
            const expected = artifact === 'maven-source-plugin' ? 'sources' : artifact === 'maven-javadoc-plugin' ? 'javadoc' : '';
            assert(typeof item === 'string' && ['', expected].includes(interpolate(item, props)), `Unsupported classifier: ${artifact}`);
          } else visit(item);
        }
      };
      visit(config);
    }
    assert(artifact !== 'maven-jar-plugin' || !values(plugin, 'executions/execution/goals/goal').includes('test-jar'), 'Unsupported test-jar attachment');
  }
}

function checkPublisher(project: Xml, deploymentName: string): void {
  const plugins = elements(project, 'build/plugins/plugin').filter(p => text(p, 'artifactId') === 'central-publishing-maven-plugin');
  assert(plugins.length === 1, 'Expected exactly one active Central publishing plugin');
  const plugin = plugins[0]!;
  assert(text(plugin, 'groupId') === 'org.sonatype.central' && text(plugin, 'version') === '0.11.0' && text(plugin, 'extensions').toLowerCase() === 'true', 'Release requires Central plugin 0.11.0 with extensions=true');
  const executions = elements(plugin, 'executions/execution'), execution = executions[0] ?? {};
  assert(executions.length === 1 && text(execution, 'id') === 'injected-central-publishing' && text(execution, 'phase') === 'deploy'
    && isDeepStrictEqual(values(execution, 'goals/goal'), ['publish']) && text(execution, 'inherited', 'true').toLowerCase() === 'true'
    && Object.keys(execution).every(k => ['id', 'phase', 'goals', 'inherited', 'configuration'].includes(k)), 'Central requires its single standard injected-central-publishing execution');
  const accepted: Record<string, string[]> = {
    centralBaseUrl: ['', 'https://central.sonatype.com', 'https://central.sonatype.com/'], publishingServerId: ['', 'central'],
    outputDirectory: [''], outputFilename: ['', 'central-bundle.zip'], stagingDirectory: [''], deferredDirectory: [''], centralSnapshotsUrl: [''],
    autoPublish: ['', 'true', '${autoPublish}'], waitUntil: ['', 'published', '${waitUntil}'], deploymentName: ['', '${deploymentName}', deploymentName],
    checksums: ['', 'all', 'required'], skipPublishing: ['', 'false'], ignorePublishedComponents: ['', 'false'], failOnBuildFailure: ['', 'true'], excludeArtifacts: [''],
  };
  const props = properties(project);
  const boundProperties = new Set([...Object.keys(accepted), 'publishCompletionPollInterval', 'waitForPublishCompletion', 'waitMaxTime', 'waitPollingInterval']);
  const settings = [...Object.entries(props).filter(([key]) => boundProperties.has(key)),
    ...elements(plugin, 'configuration').flatMap(Object.entries), ...elements(execution, 'configuration').flatMap(Object.entries)];
  for (const [key, raw] of settings) {
    assert(typeof raw === 'string', `Unsupported structured Central setting: ${key}`);
    let value = interpolate(raw, props);
    if (key === 'waitMaxTime' || key === 'waitPollingInterval') {
      const minimum = key === 'waitMaxTime' ? 1800 : 5, maximum = key === 'waitMaxTime' ? 7200 : 60;
      assert(/^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum, `Unsupported Central retry setting: ${key}`);
    } else {
      if (['checksums', 'waitUntil'].includes(key) && !value.startsWith('${')) value = value.toLowerCase();
      assert(accepted[key]?.includes(value), `Unsupported production Central configuration: ${key}`);
    }
  }
}

/** Parse the complete effective reactor before release credentials become available. */
export async function readModel(effectivePath: string, version: string, deploymentName: string): Promise<Model> {
  releaseVersion(version);
  const data = await readFile(effectivePath), root = xml(data, effectivePath);
  assert(Object.hasOwn(root, 'project') || Object.hasOwn(root, 'projects'), 'Expected effective POM project/projects root');
  const projects = Object.hasOwn(root, 'project') ? elements(root, 'project') : elements(root, 'projects/project');
  assert(projects.length > 0, 'Effective POM contains no reactor projects');
  const seen = new Set<string>();
  const modules = projects.map(project => {
    const module: Module = { groupId: text(project, 'groupId'), artifactId: text(project, 'artifactId'), version: text(project, 'version'), packaging: text(project, 'packaging', 'jar'), bodyPaths: [], metadata: metadata(project) };
    const label = GAV.map(k => module[k]).join(':');
    assert(module.version === version && !seen.has(label), `Mixed or duplicate reactor coordinates: ${label}`);
    seen.add(label); module.bodyPaths = bodyPaths(module); checkMetadata(module.metadata, label); checkReleaseConfiguration(project);
    checkPublisher(project, deploymentName);
    const versions = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(versions);
      for (const [key, item] of Object.entries(object(value))) {
        if (key === 'version') { assert(typeof item === 'string', `Invalid version: ${label}`); fixedVersion(item); }
        else versions(item);
      }
    };
    for (const [key, value] of Object.entries(project)) if (!['profiles', 'properties'].includes(key)) versions({ [key]: value });
    return module;
  });
  assert(projects.reduce((count, project) => count + values(project, 'modules/module').length, 0) === projects.length - 1, 'Effective POM is not the complete reactor; do not use -N or -pl');
  return { schemaVersion: 1, version, effectivePomSha256: digest(data), modules, bodyCount: modules.reduce((n, m) => n + m.bodyPaths.length, 0) };
}

function safePath(name: string, outer: boolean): string {
  const result = outer ? name.replaceAll('\\', '/') : name;
  assert(result !== '' && !/[\\:\x00-\x1f]/.test(result) && !result.startsWith('/')
    && result.replace(/\/$/, '').split('/').every(p => p !== '' && p !== '.' && p !== '..'), `Unsafe ZIP path: ${name}`);
  return result;
}

function archive(data: Uint8Array, outer = false): Map<string, Uint8Array> {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  assert(end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) === 0x06054b50, 'Invalid ZIP end record');
  assert(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === bytes.readUInt16LE(end + 10), 'Multi-volume ZIP is unsupported');
  const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16), directorySize = bytes.readUInt32LE(end + 12);
  assert(count !== 65535 && offset !== 0xffffffff && offset + directorySize === end, 'Invalid or unsupported ZIP64 directory');
  const entries = new Map<string, { original: string; size: number; crc: number }>();
  let position = offset, total = 0;
  for (let i = 0; i < count; i++) {
    assert(position + 46 <= end && bytes.readUInt32LE(position) === 0x02014b50, 'Invalid ZIP directory entry');
    const flags = bytes.readUInt16LE(position + 8), size = bytes.readUInt32LE(position + 24), nameLength = bytes.readUInt16LE(position + 28);
    const next = position + 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
    assert(next <= end, 'Truncated ZIP directory');
    const original = strFromU8(bytes.subarray(position + 46, position + 46 + nameLength), !(flags & 2048)), name = safePath(original, outer);
    const mode = bytes.readUInt32LE(position + 38) >>> 16 & 0xf000;
    total += size;
    assert(!entries.has(name) && !(flags & 1) && [0, 0x8000, 0x4000].includes(mode), `Duplicate, encrypted or non-regular ZIP entry: ${name}`);
    assert(size <= MAX_FILE && total <= MAX_TOTAL, 'ZIP exceeds uncompressed size limits');
    const local = bytes.readUInt32LE(position + 42);
    assert(local + 30 <= offset && bytes.readUInt32LE(local) === 0x04034b50, 'Invalid ZIP local header');
    const localName = strFromU8(bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)), !(flags & 2048));
    assert(localName === original && bytes.readUInt16LE(local + 6) === flags, 'ZIP local/directory names or flags differ');
    entries.set(name, { original, size, crc: bytes.readUInt32LE(position + 16) }); position = next;
  }
  assert(position === end, 'Unexpected ZIP directory data');
  const extracted = unzipSync(data, { filter: entry => {
    const declared = entries.get(safePath(entry.name, outer));
    assert(declared && declared.original === entry.name && declared.size === entry.originalSize, 'ZIP extraction differs from validated directory');
    return true;
  } });
  assert(Object.keys(extracted).length === entries.size, 'ZIP entry count differs');
  const result = new Map<string, Uint8Array>();
  for (const [name, entry] of entries) {
    const content = extracted[entry.original];
    assert(content && content.length === entry.size && crc32(content) === entry.crc, `ZIP length/CRC mismatch: ${name}`);
    if (!name.endsWith('/')) result.set(name, content);
  }
  return result;
}

function rawPom(data: Uint8Array, label: string): { root: Xml; coordinates: Coordinates; props: Record<string, string> } {
  const document = xml(data, label);
  assert(Object.hasOwn(document, 'project'), `Not a Maven POM: ${label}`);
  const root = object(document.project), props = properties(root);
  const parent = Object.fromEntries(GAV.map(k => [k, interpolate(text(root, `parent/${k}`), props)])) as Coordinates;
  const coordinates = Object.fromEntries(GAV.map(k => [k, interpolate(text(root, k, k === 'artifactId' ? '' : parent[k]), props)])) as Coordinates;
  for (const key of GAV) {
    for (const prefix of ['project.', 'pom.']) props[prefix + key] = coordinates[key];
    for (const prefix of ['project.parent.', 'pom.parent.', 'parent.']) props[prefix + key] = parent[key];
  }
  for (const field of ['name', 'description', 'url', 'packaging', 'scm.url', 'scm.connection', 'scm.developerConnection']) {
    const value = text(root, field.replaceAll('.', '/'));
    if (value) for (const prefix of ['project.', 'pom.']) props[prefix + field] = value;
  }
  for (const key of GAV) coordinates[key] = interpolate(coordinates[key], props);
  return { root, coordinates, props };
}

function checkJar(data: Uint8Array, path: string): void {
  const entries = archive(data), names = [...entries.keys()];
  assert(names.length > 0, `Empty JAR: ${path}`);
  if (path.endsWith('-sources.jar')) {
    const sources = names.filter(n => n.endsWith('.java') && Buffer.from(entries.get(n)!).toString('utf8').trim());
    assert(sources.includes('module-info.java') && sources.some(n => !['module-info.java', 'package-info.java'].includes(n.split('/').at(-1)!)), `Sources JAR lacks JPMS descriptor or sources: ${path}`);
  } else if (path.endsWith('-javadoc.jar')) {
    const html = names.filter(n => n.endsWith('.html') && Buffer.from(entries.get(n)!).toString('utf8').trim());
    assert(html.includes('index.html') && html.length >= 2, `Javadoc JAR lacks index or pages: ${path}`);
  } else {
    const classes = names.filter(n => n.endsWith('.class'));
    assert(classes.some(n => /^(?:META-INF\/versions\/\d+\/)?module-info\.class$/.test(n)) && classes.some(n => !['module-info.class', 'package-info.class'].includes(n.split('/').at(-1)!)), `Main JAR lacks JPMS descriptor or library classes: ${path}`);
    for (const name of classes) {
      const content = entries.get(name)!;
      assert(content.length >= 8 && Buffer.from(content).readUInt32BE(0) === 0xcafebabe, `Invalid Java class: ${path}:${name}`);
    }
  }
}

/** Bind actual signed ZIP bytes to every expected reactor component. */
export async function inspectBundle(bundlePath: string, model: Model): Promise<Manifest> {
  assert(model.schemaVersion === 1 && model.modules?.length > 0, 'Unsupported or empty reactor model');
  releaseVersion(model.version);
  const bodies = new Map<string, Module>();
  for (const module of model.modules) {
    assert(module.version === model.version, 'Mixed reactor versions');
    checkMetadata(module.metadata, module.artifactId);
    const paths = bodyPaths(module);
    assert(isDeepStrictEqual(paths, module.bodyPaths), 'Stored module paths differ from coordinates');
    for (const path of paths) { assert(!bodies.has(path), `Duplicate model body: ${path}`); bodies.set(path, module); }
  }
  const required = new Set(bodies.keys()), allowed = new Set(bodies.keys());
  for (const body of bodies.keys()) {
    for (const suffix of ['.asc', '.md5', '.sha1']) required.add(body + suffix);
    allowed.add(`${body}.asc`);
    for (const checksum of Object.keys(CHECKSUMS)) { allowed.add(`${body}.${checksum}`); allowed.add(`${body}.asc.${checksum}`); }
  }
  const bytes = await readFile(bundlePath), data = archive(bytes, true);
  assert([...required].every(p => data.has(p)) && [...data.keys()].every(p => allowed.has(p)), 'Bundle contents differ from reactor model');
  const files = [...data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, content]) => {
    assert(content.length > 0, `Empty bundle file: ${path}`);
    const suffix = path.split('.').at(-1)!;
    let kind = 'body';
    if (Object.hasOwn(CHECKSUMS, suffix)) {
      kind = 'checksum';
      const checksum = Buffer.from(content).toString('ascii').trim(), target = data.get(path.slice(0, -(suffix.length + 1)));
      assert(content.every(b => b < 128) && new RegExp(`^[0-9A-Fa-f]{${CHECKSUMS[suffix]}}$`).test(checksum) && target && checksum.toLowerCase() === digest(target, suffix), `Checksum mismatch: ${path}`);
    } else if (suffix === 'asc') {
      kind = 'signature';
      assert(Buffer.from(content).toString('ascii').trimStart().startsWith('-----BEGIN PGP SIGNATURE-----'), `Expected armored signature: ${path}`);
    } else if (suffix === 'pom') {
      const { root, coordinates } = rawPom(content, path), module = bodies.get(path)!;
      assert(GAV.every(k => coordinates[k] === module[k]) && text(root, 'packaging', 'jar') === module.packaging, `POM coordinates/packaging differ: ${path}`);
    } else checkJar(content, path);
    return { path, size: content.length, sha256: digest(content), kind };
  });
  return { schemaVersion: 1, version: model.version, effectivePomSha256: model.effectivePomSha256, modules: model.modules, bodyCount: bodies.size, bundleSha256: digest(bytes), files };
}

async function boundManifest(bundlePath: string, manifest: Manifest): Promise<void> {
  assert(isDeepStrictEqual(await inspectBundle(bundlePath, manifest), manifest), 'Manifest does not exactly describe retained bundle/model');
}

async function signatures(data: Map<string, Uint8Array>, manifest: Manifest, fingerprint: string, gpgHome: string): Promise<number> {
  assert(fingerprint === fingerprint.trim() && /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint), 'Expected full primary GPG fingerprint');
  const directory = await mkdtemp(join(tmpdir(), 'allurx-signatures-'));
  let count = 0;
  try {
    for (const item of manifest.files.filter(f => f.kind === 'body')) {
      const body = join(directory, 'body'), signature = join(directory, 'body.asc');
      await writeFile(body, data.get(item.path)!); await writeFile(signature, data.get(`${item.path}.asc`)!);
      const { stdout } = await promisify(execFile)('gpg', ['--no-options', '--batch', '--homedir', gpgHome, '--no-auto-key-retrieve', '--status-fd', '1', '--verify', signature, body], { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
      const valid: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const fields = line.trim().split(/\s+/);
        if (fields[0] !== '[GNUPG:]') continue;
        assert(!['BADSIG', 'ERRSIG', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'NO_PUBKEY'].includes(fields[1] ?? ''), `GPG rejected signature: ${item.path}`);
        if (fields[1] === 'VALIDSIG' && fields.length >= 11) valid.push((fields[11] ?? fields[2]!).toUpperCase());
      }
      assert(isDeepStrictEqual(valid, [fingerprint]), `Signature primary fingerprint differs: ${item.path}`); count++;
    }
    return count;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function verifySignatures(bundlePath: string, manifest: Manifest, fingerprint: string, gpgHome: string): Promise<Record<string, unknown>> {
  await boundManifest(bundlePath, manifest); fingerprint = fingerprint.replaceAll(' ', '').toUpperCase();
  return { fingerprint, verifiedSignatures: await signatures(archive(await readFile(bundlePath), true), manifest, fingerprint, gpgHome) };
}

async function download(url: string, expected?: { size: number; sha256: string }): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'allurx-build/1', 'Accept-Encoding': 'identity' } });
      if (!response.ok) {
        await response.body?.cancel();
        if (![404, 408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw new TypeError(`Public download failed: HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status}`);
      }
      assert(response.body, 'Missing public response body');
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; assert(size <= (expected?.size ?? MAX_FILE) && size <= MAX_FILE, 'Public download exceeds size limit'); chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      assert(!expected || size === expected.size && digest(data) === expected.sha256, 'Public bytes differ from retained bundle');
      return data;
    } catch (error) { if (error instanceof TypeError && error.message.startsWith('Public download failed:')) throw error; lastError = error; }
    if (attempt < 5) await delay(10_000);
  }
  throw new Error(`Public download did not verify after 6 attempts: ${url}`, { cause: lastError });
}

async function publicMetadata(downloads: Map<string, Uint8Array>, modules: Module[], repository: string): Promise<Record<string, unknown>[]> {
  const cache = new Map<string, { meta: Metadata; props: Record<string, string> }>(), parents: Record<string, unknown>[] = [];
  const resolve = async (coordinates: Coordinates, visiting: Set<string>): Promise<{ meta: Metadata; props: Record<string, string> }> => {
    const key = GAV.map(k => coordinates[k]).join(':');
    assert(!visiting.has(key) && visiting.size < 16, `Cyclic/deep public POM parent chain: ${key}`);
    const cached = cache.get(key); if (cached) return cached;
    const path = bodyPaths({ ...coordinates, packaging: 'pom' })[0]!;
    let data = downloads.get(path);
    if (!data) { data = await download(`${repository}/${path}`); parents.push({ path, size: data.length, sha256: digest(data) }); }
    const raw = rawPom(data, path);
    assert(isDeepStrictEqual(raw.coordinates, coordinates), `Published POM coordinates differ: ${path}`);
    let inherited: { meta: Metadata; props: Record<string, string> } | undefined;
    if (raw.root.parent !== undefined) {
      const parent = Object.fromEntries(GAV.map(k => [k, interpolate(text(raw.root, `parent/${k}`), raw.props)])) as Coordinates;
      inherited = await resolve(parent, new Set([...visiting, key]));
    }
    const props = { ...inherited?.props, ...raw.props }, meta = metadata(raw.root);
    if (inherited) {
      for (const field of ['name', 'description', 'url'] as const) meta[field] ||= inherited.meta[field];
      if (meta.licenses.length === 0) meta.licenses = inherited.meta.licenses;
      if (meta.developers.length === 0) meta.developers = inherited.meta.developers;
      for (const field of ['url', 'connection', 'developerConnection'] as const) meta.scm[field] ||= inherited.meta.scm[field];
    }
    const expand = (value: unknown): unknown => typeof value === 'string' ? interpolate(value, props) : Array.isArray(value) ? value.map(expand) : Object.fromEntries(Object.entries(object(value)).map(([k, v]) => [k, expand(v)]));
    const result = { meta: expand(meta) as Metadata, props }; cache.set(key, result); return result;
  };
  for (const module of modules) {
    const coordinates = Object.fromEntries(GAV.map(k => [k, module[k]])) as Coordinates;
    checkMetadata((await resolve(coordinates, new Set())).meta, module.artifactId);
  }
  return parents;
}

/** Verify consumers can retrieve the exact original publication from Maven Central. */
export async function verifyPublic(bundlePath: string, manifest: Manifest, fingerprint: string, gpgHome: string): Promise<Record<string, unknown>> {
  const repository = PUBLIC_REPOSITORY;
  fingerprint = fingerprint.replaceAll(' ', '').toUpperCase();
  await boundManifest(bundlePath, manifest);
  const downloads = new Map<string, Uint8Array>();
  for (const item of manifest.files) downloads.set(item.path, await download(`${repository}/${item.path}`, item));
  const count = await signatures(downloads, manifest, fingerprint, gpgHome);
  return { schemaVersion: 1, verified: true, version: manifest.version, repository, bundleSha256: manifest.bundleSha256, fingerprint,
    bodyCount: manifest.bodyCount, verifiedSignatures: count, fileCount: manifest.files.length, files: manifest.files,
    externalParents: await publicMetadata(downloads, manifest.modules, repository) };
}
