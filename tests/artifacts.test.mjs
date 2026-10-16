import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { inspectBundle, readModel, verifyPublic, verifySignatures } from '../dist/artifacts.js';

let directory, keyring, fingerprint;
let sequence = 0;
const version = '1.2.3';
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const zip = (entries) => zipSync(Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, typeof data === 'string' ? Buffer.from(data) : data])));
const classFile = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 69]);
const metadata = '<name>Fixture</name><description>Release fixture</description><url>https://example.invalid/fixture</url><licenses><license><name>MIT</name><url>https://example.invalid/license</url></license></licenses><developers><developer><id>fixture</id></developer></developers><scm><url>https://example.invalid/source</url><connection>scm:git:https://example.invalid/source.git</connection><developerConnection>scm:git:https://example.invalid/source.git</developerConnection></scm>';
const central = (configuration = '', executionConfiguration = '') => `<plugin><groupId>org.sonatype.central</groupId><artifactId>central-publishing-maven-plugin</artifactId><version>0.11.0</version><extensions>true</extensions><configuration>${configuration}</configuration><executions><execution><id>injected-central-publishing</id><phase>deploy</phase><goals><goal>publish</goal></goals><configuration>${executionConfiguration}</configuration></execution></executions></plugin>`;
const project = ({ id = 'library', packaging = 'jar', modules = [], properties = '', configuration = '', executionConfiguration = '', extra = '', plugins = '', release = version } = {}) => `<project><modelVersion>4.0.0</modelVersion><groupId>test.fixture</groupId><artifactId>${id}</artifactId><version>${release}</version><packaging>${packaging}</packaging>${metadata}<properties>${properties}</properties><modules>${modules.map(id => `<module>${id}</module>`).join('')}</modules>${extra}<build><plugins>${central(configuration, executionConfiguration)}${plugins}</plugins></build></project>`;
const model = async (projects) => {
  const path = join(directory, `effective-${sequence++}.xml`);
  await writeFile(path, `<projects>${projects.join('')}</projects>`);
  return readModel(path, version, 'fixture-1.2.3');
};
const reference = (id, element) => `<${element}><groupId>test.fixture</groupId><artifactId>${id}</artifactId><version>${version}</version></${element}>`;
const fixtureReactor = () => [
  project({ id: 'parent', packaging: 'pom', modules: ['library', 'starter', 'samples'] }),
  project(), project({ id: 'starter' }),
  project({ id: 'samples', packaging: 'pom', modules: ['sample-web'], properties: '<skipPublishing>true</skipPublishing>' }),
  project({ id: 'sample-web', properties: '<skipPublishing>true</skipPublishing>' }),
];
const jarBodies = (kind) => kind === 'starter' ? [
  zip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' }),
  zip({ 'README.md': '# Dependency starter\nThis module has no Java source. See its POM and project documentation.\n' }),
  zip({ 'README.md': '# Dependency starter\nAPI documentation belongs to the implementation dependency.\n' }),
] : [
  zip({ 'module-info.class': classFile, 'fixture/Library.class': classFile }),
  zip({ 'module-info.java': 'module fixture.library { exports fixture; }', 'fixture/Library.java': 'package fixture; public class Library {}' }),
  zip({ 'index.html': '<html>Library API</html>', 'fixture/Library.html': '<html>Library class</html>' }),
];
const bodyFiles = (publication) => {
  const result = {};
  for (const module of publication.modules) {
    const pom = `<project><modelVersion>4.0.0</modelVersion><groupId>${module.groupId}</groupId><artifactId>${module.artifactId}</artifactId><version>${module.version}</version><packaging>${module.packaging}</packaging>${metadata}</project>`;
    result[module.bodyPaths[0]] = Buffer.from(pom);
    if (module.packaging === 'jar') jarBodies(module.artifactId === 'starter' ? 'starter' : 'library').forEach((bytes, index) => { result[module.bodyPaths[index + 1]] = bytes; });
  }
  return result;
};
const completeFiles = (bodies, signatures = {}) => Object.fromEntries(Object.entries(bodies).flatMap(([path, bytes]) => [
  [path, bytes], [path + '.asc', signatures[path] ?? Buffer.from('-----BEGIN PGP SIGNATURE-----\nfixture\n')],
  [path + '.md5', Buffer.from(hash(bytes, 'md5'))], [path + '.sha1', Buffer.from(hash(bytes, 'sha1'))],
]));
const bundle = async (files) => {
  const path = join(directory, `bundle-${sequence++}.zip`);
  await writeFile(path, zip(files));
  return path;
};
const gpg = (...args) => execFileSync('gpg', ['--no-options', '--batch', '--homedir', keyring, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'allurx-artifacts-test-'));
});
after(async () => {
  if (keyring) execFileSync('gpgconf', ['--homedir', keyring, '--kill', 'all'], { windowsHide: true, stdio: 'ignore' });
  await rm(directory, { recursive: true, force: true });
});

test('complete reactor selects three published modules and keeps two excluded coordinates', async () => {
  const actual = await model(fixtureReactor());
  assert.equal(actual.schemaVersion, 2);
  assert.deepEqual(actual.modules.map(module => module.artifactId), ['parent', 'library', 'starter']);
  assert.deepEqual(actual.excludedModules.map(module => module.artifactId), ['samples', 'sample-web']);
  assert.equal(actual.bodyCount, 9);
  const allPublished = await model(fixtureReactor().map(xml => xml.replaceAll('<skipPublishing>true</skipPublishing>', '')));
  assert.equal(allPublished.modules.length, 5);
  assert.equal(allPublished.bodyCount, 14);
});

test('native skip settings must be resolved, boolean and consistent', async () => {
  for (const options of [
    { properties: '<skipPublishing>true</skipPublishing>', configuration: '<skipPublishing>${skipPublishing}</skipPublishing>', executionConfiguration: '<skipPublishing>true</skipPublishing>' },
    { configuration: '<skipPublishing>true</skipPublishing>' },
    { executionConfiguration: '<skipPublishing>true</skipPublishing>' },
  ]) {
    const result = await model([project({ id: 'parent', packaging: 'pom', modules: ['child'] }), project({ id: 'child', ...options })]);
    assert.deepEqual(result.excludedModules.map(module => module.artifactId), ['child']);
  }
  for (const options of [
    { properties: '<skipPublishing>true</skipPublishing>', configuration: '<skipPublishing>false</skipPublishing>' },
    { configuration: '<skipPublishing>true</skipPublishing>', executionConfiguration: '<skipPublishing>false</skipPublishing>' },
    { properties: '<skipPublishing>${missing}</skipPublishing>' },
    { properties: '<skipPublishing>yes</skipPublishing>' },
  ]) await assert.rejects(model([project(options)]), /skipPublishing/);
  await assert.rejects(model([project({ properties: '<skipPublishing>true</skipPublishing>' })]), /no publishable/);
});

test('build and publication safety settings remain enforced on every reactor module', async () => {
  for (const property of ['maven.deploy.skip', 'maven.source.skip', 'maven.javadoc.skip', 'gpg.skip', 'maven.test.skip', 'skipTests']) {
    await assert.rejects(model([project({ properties: `<${property}>true</${property}>` })]), /may not skip/);
  }
  for (const configuration of ['<ignorePublishedComponents>true</ignorePublishedComponents>', '<excludeArtifacts>library</excludeArtifacts>', '<failOnBuildFailure>false</failOnBuildFailure>']) {
    await assert.rejects(model([project({ configuration })]));
  }
  const excluded = fixtureReactor();
  excluded[4] = project({ id: 'sample-web', properties: '<skipPublishing>true</skipPublishing><skipTests>true</skipTests>' });
  await assert.rejects(model(excluded), /may not skip skipTests/);
  await assert.rejects(model(fixtureReactor().slice(0, 4)), /complete reactor/);
  await assert.rejects(model([project({ release: '1.2.4' })]), /Mixed/);
  await assert.rejects(model([project({ id: 'parent', packaging: 'pom', modules: ['library'] }), project({ id: 'parent' })]), /duplicate/);
});

test('published parents and dependency references cannot point at excluded reactor modules', async () => {
  for (const extra of [reference('sample-web', 'parent'), `<dependencies>${reference('sample-web', 'dependency')}</dependencies>`, `<dependencyManagement><dependencies>${reference('sample-web', 'dependency')}</dependencies></dependencyManagement>`]) {
    const reactor = fixtureReactor();
    reactor[1] = project({ extra });
    await assert.rejects(model(reactor), /references excluded reactor component/);
  }
});

test('companion classifiers are limited to additional jar executions', async () => {
  const configuration = classifier => `<configuration><classifier>${classifier}</classifier></configuration>`;
  const execution = (id, classifier, goal = 'jar') => `<execution><id>${id}</id><phase>package</phase><goals><goal>${goal}</goal></goals>${configuration(classifier)}</execution>`;
  const plugin = (executions, global = '') => `<plugin><artifactId>maven-jar-plugin</artifactId><version>3.5.1</version>${global}<executions>${executions}</executions></plugin>`;
  for (const classifier of ['sources', 'javadoc']) {
    // Match the effective starter POM: an unchanged default-jar plus one explicit attachment.
    await model([project({ plugins: plugin(execution('default-jar', '') + execution(`attach-starter-${classifier}`, classifier)) })]);
    await assert.rejects(model([project({ plugins: plugin('', configuration(classifier)) })]), /classifier/);
    await assert.rejects(model([project({ plugins: plugin(execution('default-jar', classifier)) })]), /classifier/);
    await assert.rejects(model([project({ plugins: plugin(execution('attach-companion', classifier, 'other')) })]), /classifier/);
  }
  await assert.rejects(model([project({ plugins: plugin(execution('attach-tests', 'tests')) })]), /classifier/);
});

test('JPMS and source-less artifacts retain their exact body sets', async () => {
  const publication = await model(fixtureReactor());
  const manifest = await inspectBundle(await bundle(completeFiles(bodyFiles(publication))), publication);
  assert.equal(manifest.bodyCount, 9);
  assert.equal(manifest.files.length, 36);
  assert.deepEqual(manifest.excludedModules, publication.excludedModules);
  const pomOnly = await model([project({ packaging: 'pom' })]);
  assert.equal((await inspectBundle(await bundle(completeFiles(bodyFiles(pomOnly))), pomOnly)).bodyCount, 1);
});

test('coded JAR checks do not become optional for empty or broken artifacts', async () => {
  const publication = await model([project()]);
  const paths = publication.modules[0].bodyPaths;
  for (const [index, replacement] of [
    [1, zip({ 'fixture/Library.class': classFile })],
    [1, zip({ 'module-info.class': classFile })],
    [1, zip({ 'module-info.class': classFile, 'fixture/Library.class': Buffer.from('invalid') })],
    [1, zip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' })],
    [2, zip({ 'fixture/Library.java': 'package fixture; public class Library {}' })],
    [3, zip({ 'fixture/Library.html': '<html>Missing index</html>' })],
  ]) {
    const bodies = bodyFiles(publication);
    bodies[paths[index]] = replacement;
    await assert.rejects(inspectBundle(await bundle(completeFiles(bodies)), publication));
  }
});

test('source-less companion archives contain genuine readable explanations, not fake Java or empty metadata', async () => {
  const publication = await model([project({ id: 'starter' })]);
  for (const replacement of [zip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' }), zip({ 'README.md': ' ' }), zip({ 'README.md': 'Explanation', 'module-info.java': 'module fake {}' })]) {
    const bodies = bodyFiles(publication);
    bodies[publication.modules[0].bodyPaths[2]] = replacement;
    await assert.rejects(inspectBundle(await bundle(completeFiles(bodies)), publication), /Source-less/);
  }
});

test('missing, unexpected, corrupt and unsafe bundle contents are rejected', async () => {
  const publication = await model(fixtureReactor());
  const good = completeFiles(bodyFiles(publication));
  const first = publication.modules[0].bodyPaths[0];
  const missing = { ...good }; delete missing[first];
  const missingSignature = { ...good }; delete missingSignature[first + '.asc'];
  for (const files of [missing, missingSignature, { ...good, 'test/fixture/sample-web/1.2.3/sample-web-1.2.3.pom': Buffer.from('<project/>') }, { ...good, [first + '.sha1']: Buffer.from('0'.repeat(40)) }, { ...good, '../escape': Buffer.from('unsafe') }]) {
    await assert.rejects(inspectBundle(await bundle(files), publication));
  }
  const truncated = await bundle(good);
  await writeFile(truncated, (await readFile(truncated)).subarray(0, 25));
  await assert.rejects(inspectBundle(truncated, publication), /ZIP/);
});

test('real isolated signatures and public byte verification reject altered evidence', async (t) => {
  keyring = join(directory, 'gnupg');
  await mkdir(keyring, { mode: 0o700 });
  gpg('--pinentry-mode', 'loopback', '--passphrase', '', '--quick-generate-key', 'Allurx release fixture <fixture@example.invalid>', 'ed25519', 'sign', '0');
  fingerprint = gpg('--with-colons', '--list-secret-keys').split(/\r?\n/).find(line => line.startsWith('fpr:')).split(':')[9];
  const publication = await model([project({ id: 'starter' })]);
  const bodies = bodyFiles(publication), signatures = {};
  for (const [path, bytes] of Object.entries(bodies)) {
    const input = join(directory, 'signing-body'), signature = input + '.asc';
    await writeFile(input, bytes);
    gpg('--yes', '--pinentry-mode', 'loopback', '--passphrase', '', '--armor', '--detach-sign', '--local-user', fingerprint, '--output', signature, input);
    signatures[path] = await readFile(signature);
  }
  const files = completeFiles(bodies, signatures), path = await bundle(files);
  const manifest = await inspectBundle(path, publication);
  assert.equal((await verifySignatures(path, manifest, fingerprint, keyring)).verifiedSignatures, 4);
  await assert.rejects(verifySignatures(path, manifest, 'A'.repeat(40), keyring), /fingerprint differs/);
  await assert.rejects(verifySignatures(path, { ...manifest, bundleSha256: '0'.repeat(64) }, fingerprint, keyring), /Manifest does not exactly/);

  const first = publication.modules[0].bodyPaths[0];
  const alteredBodies = { ...bodies, [first]: Buffer.from(bodies[first].toString().replace('Release fixture', 'Changed fixture')) };
  const altered = await bundle(completeFiles(alteredBodies, signatures));
  await assert.rejects(verifySignatures(altered, await inspectBundle(altered, publication), fingerprint, keyring));

  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.startsWith('https://repo.maven.apache.org/maven2/'));
    const relative = url.slice('https://repo.maven.apache.org/maven2/'.length);
    assert.ok(Object.hasOwn(files, relative), 'Only planned public files may be requested');
    return new Response(files[relative]);
  });
  const verified = await verifyPublic(path, manifest, fingerprint, keyring);
  assert.equal(verified.verified, true);
  assert.equal(verified.verifiedSignatures, 4);
  assert.equal(verified.fileCount, 16);
});
