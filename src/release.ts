import { mkdir, mkdtemp, copyFile, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGithub, validateTag } from './github.js';
import { inspectBundle, readModel, verifyPublic, verifySignatures, type Manifest, type Model } from './artifacts.js';
import { asObject, assert, env, int, output, readJson, request, run, sha256, str, stream, writeJson, type JsonObject } from './util.js';

interface Plan {
  schemaVersion: 1;
  repository: string;
  tag: string;
  tagObject: string;
  commit: string;
  version: string;
  runId: number;
  runAttempt: number;
  sharedWorkflowSha: string;
  ci: JsonObject;
  outputTimestamp: string;
  signingFingerprint: string;
  deploymentName: string;
  model: Model;
}

type Github = ReturnType<typeof createGithub>;
const deployId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const exists = async (path: string): Promise<boolean> => {
  try { return (await stat(path)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
};

function maven(plan: Pick<Plan, 'signingFingerprint' | 'deploymentName' | 'outputTimestamp'>): string[] {
  return ['-B', '-ntp', '-Prelease', '-DautoPublish=true', '-DwaitUntil=published', '-Dgpg.bestPractices=true',
    `-Dgpg.keyname=${plan.signingFingerprint}`, `-DdeploymentName=${plan.deploymentName}`,
    `-Dproject.build.outputTimestamp=${plan.outputTimestamp}`];
}

async function validatePlan(value: JsonObject, api: Github): Promise<Plan> {
  assert(int(value, 'schemaVersion') === 1 && str(value, 'repository') === api.repository, 'Unsupported release plan');
  assert(validateTag(str(value, 'tag')) === str(value, 'version'), 'Plan tag/version mismatch');
  for (const field of ['commit', 'tagObject', 'sharedWorkflowSha'])
    assert(str(value, field).length === 40 && /^[a-f0-9]{40}$/.test(str(value, field)), `Invalid plan SHA: ${field}`);
  assert(str(value, 'sharedWorkflowSha') === env('SHARED_WORKFLOW_SHA'), 'Release plan requires the original shared workflow SHA');
  assert([40, 64].includes(str(value, 'signingFingerprint').length) && /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(str(value, 'signingFingerprint')), 'Invalid signing fingerprint');
  assert(/^\d+$/.test(str(value, 'outputTimestamp')) && str(value, 'deploymentName').length > 0, 'Invalid release metadata');
  assert(int(value, 'runId') > 0 && int(value, 'runAttempt') > 0, 'Invalid original run');
  asObject(value.model);
  asObject(value.ci);
  const remote = await api.tag(str(value, 'tag'));
  assert(remote.commit === str(value, 'commit') && remote.tagObject === str(value, 'tagObject'), 'Remote tag moved after planning');
  // Manifest generation checks the saved model against the complete retained bundle.
  return value as unknown as Plan;
}

async function publicationPlan(api: Github, directory: string): Promise<Plan> {
  const ref = env('GITHUB_REF');
  assert(env('GITHUB_EVENT_NAME') === 'push' && ref.startsWith('refs/tags/'), 'Publish requires a tag push');
  const tag = ref.slice('refs/tags/'.length);
  const version = validateTag(tag);
  assert(!env('RELEASE_TAG', '') || env('RELEASE_TAG') === tag, 'Event and input tags differ');
  const runId = Number(env('GITHUB_RUN_ID'));
  const attempt = Number(env('GITHUB_RUN_ATTEMPT'));
  assert(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0, 'Invalid run identity');
  await api.noPreviousDeploy(runId, attempt);
  const remote = await api.tag(tag);
  const commit = await run('git', ['rev-parse', 'HEAD']);
  assert(commit === remote.commit, 'Checkout does not match the annotated tag');
  await api.noDuplicateRun(runId, tag, commit);
  await run('git', ['fetch', '--no-tags', 'origin', 'main']);
  await run('git', ['merge-base', '--is-ancestor', commit, 'FETCH_HEAD']);
  const ci = await api.exactCi(commit);
  const fingerprint = env('RELEASE_GPG_FINGERPRINT').replaceAll(' ', '').toUpperCase();
  assert([40, 64].includes(fingerprint.length) && /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint), 'A complete GPG primary fingerprint is required');
  const shared = env('SHARED_WORKFLOW_SHA');
  assert(shared.length === 40 && /^[a-f0-9]{40}$/.test(shared), 'Shared workflow must resolve to an immutable SHA');
  const settings = {
    signingFingerprint: fingerprint,
    deploymentName: `${api.repository.replace('/', '-')}-${version}`,
    outputTimestamp: await run('git', ['show', '-s', '--format=%ct', 'HEAD']),
  };
  const effective = join(directory, 'effective-pom.xml');
  await run('mvn', [...maven(settings), 'org.apache.maven.plugins:maven-help-plugin:3.5.2:effective-pom', `-Doutput=${effective}`]);
  return {
    schemaVersion: 1, repository: api.repository, tag, tagObject: str(remote, 'tagObject'), commit, version,
    runId, runAttempt: attempt, sharedWorkflowSha: shared, ci, ...settings,
    model: await readModel(effective, version, settings.deploymentName),
  };
}

async function manifest(plan: Plan, directory: string) {
  const bundle = join(directory, 'bundle.zip');
  if (!await exists(bundle)) {
    const entries = await readdir('.', { recursive: true, withFileTypes: true });
    // Absolute paths make the suffix match the root project's target directory too.
    const bundles = entries.filter(entry => entry.isFile() && entry.name === 'central-bundle.zip')
      .map(entry => resolve(entry.parentPath, entry.name)).filter(path => path.replaceAll('\\', '/').endsWith('/target/central-publishing/central-bundle.zip'));
    assert(bundles.length === 1 && bundles[0], 'Expected one complete reactor Central bundle');
    await copyFile(bundles[0], bundle);
  }
  const result = await inspectBundle(bundle, plan.model);
  await writeJson(join(directory, 'manifest.json'), result);
  return result;
}

async function deploymentStatus(plan: Plan, identifier: string, seconds: number): Promise<JsonObject> {
  assert(deployId.test(identifier), 'Original deployment UUID is required');
  const token = Buffer.from(`${env('CENTRAL_USERNAME')}:${env('CENTRAL_PASSWORD')}`).toString('base64');
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    const response = await request(`https://central.sonatype.com/api/v1/publisher/status?id=${identifier}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert(response.status === 200, `Central status query returned HTTP ${response.status}`);
    const status = asObject(await response.json());
    assert(str(status, 'deploymentId') === identifier && str(status, 'deploymentName') === plan.deploymentName, 'Central deployment does not match the saved plan');
    const state = str(status, 'deploymentState');
    if (state === 'PUBLISHED') return status;
    assert(['PENDING', 'VALIDATING', 'PUBLISHING'].includes(state), `Central state requires investigation: ${state}`);
    assert(Date.now() < deadline, `Central is still ${state}; inspect the existing deployment before taking further action`);
    await new Promise(resolve => setTimeout(resolve, Math.min(10_000, deadline - Date.now())));
  }
}

async function deploy(api: Github, directory: string, plan: Plan): Promise<void> {
  const planFile = join(directory, 'release-plan.json');
  const evidenceFile = join(directory, 'release-evidence.json');
  assert(plan.runId === Number(env('GITHUB_RUN_ID')) && plan.runAttempt === Number(env('GITHUB_RUN_ATTEMPT'))
    && env('GITHUB_EVENT_NAME') === 'push' && !await exists(evidenceFile), 'Deploy may only enter once in its original attempt');
  const temporary = await mkdtemp(join(tmpdir(), 'allurx-plan-'));
  try {
    await api.artifact(plan.runId, `release-plan-${plan.runAttempt}`, temporary);
    assert(await sha256(join(temporary, 'release-plan.json')) === await sha256(planFile), 'Plan must be persisted before upload');
  } finally { await rm(temporary, { recursive: true, force: true }); }
  await api.exactCi(plan.commit);
  await api.noDuplicateRun(plan.runId, plan.tag, plan.commit);
  assert(await run('git', ['rev-parse', 'HEAD']) === plan.commit, 'Checkout changed after planning');
  const key = await run('gpg', ['--batch', '--armor', '--export', plan.signingFingerprint]);
  assert(key.includes('BEGIN PGP PUBLIC KEY BLOCK'), 'Expected signing identity is not imported');
  await writeFile(join(directory, 'signing-public-key.asc'), `${key}\n`);
  const evidence: JsonObject = { schemaVersion: 1, planSha256: await sha256(planFile), state: 'UPLOAD_STATUS_UNKNOWN' };
  await writeJson(evidenceFile, evidence);
  const log = join(directory, 'maven-deploy.log');
  const result = await stream(log, 'mvn', [...maven(plan), 'clean', 'deploy']);
  evidence.mavenExitCode = result;
  const identifiers = new Set([... (await readFile(log, 'utf8')).matchAll(/(?:deploymentId[=: ]+|deployment\s+)([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/gi)].map(match => match[1]));
  if (identifiers.size === 1) evidence.deploymentId = [...identifiers][0];
  await writeJson(evidenceFile, evidence);
  try {
    const contents = await manifest(plan, directory);
    await verifySignatures(join(directory, 'bundle.zip'), contents, plan.signingFingerprint, env('GNUPGHOME'));
    if (str(evidence, 'deploymentId')) {
      const status = await deploymentStatus(plan, str(evidence, 'deploymentId'), result === 0 ? 120 : 0);
      evidence.state = str(status, 'deploymentState');
      evidence.centralStatus = status;
    }
  } finally { await writeJson(evidenceFile, evidence); }
  assert(result === 0 && evidence.state === 'PUBLISHED', 'Publication is not fully confirmed; inspect the existing deployment and evidence without redeploying');
}

function releaseReport(plan: Plan, contents: Manifest, verification: JsonObject, evidence: JsonObject, planHash: string): JsonObject {
  return {
    schemaVersion: 1,
    release: { repository: plan.repository, tag: plan.tag, version: plan.version, commit: plan.commit, tagObject: plan.tagObject },
    provenance: {
      runId: plan.runId, runAttempt: plan.runAttempt, sharedWorkflowSha: plan.sharedWorkflowSha, ci: plan.ci,
      outputTimestamp: plan.outputTimestamp, planSha256: planHash, effectivePomSha256: contents.effectivePomSha256,
    },
    publication: {
      deploymentId: str(evidence, 'deploymentId'), deploymentName: plan.deploymentName, state: str(evidence, 'state'),
      repository: str(verification, 'repository'), bundleSha256: contents.bundleSha256,
    },
    signing: { fingerprint: plan.signingFingerprint, publicKey: 'signing-public-key.asc' },
    artifacts: {
      modules: contents.modules.map(({ groupId, artifactId, packaging }) => ({ groupId, artifactId, packaging })),
      files: contents.files,
    },
    verification: {
      verified: verification.verified, bodyCount: verification.bodyCount, fileCount: verification.fileCount,
      verifiedSignatures: verification.verifiedSignatures, externalParents: verification.externalParents,
    },
  };
}

async function finish(api: Github, directory: string, plan: Plan): Promise<void> {
  const evidence = await readJson(join(directory, 'release-evidence.json'));
  const planHash = await sha256(join(directory, 'release-plan.json'));
  assert(str(evidence, 'state') === 'PUBLISHED' && str(evidence, 'planSha256') === planHash, 'Published deployment evidence is missing');
  const contents = await manifest(plan, directory);
  const keyring = await mkdtemp(join(tmpdir(), 'allurx-verify-'));
  try {
    await run('gpg', ['--batch', '--homedir', keyring, '--import', join(directory, 'signing-public-key.asc')]);
    const report = await verifyPublic(join(directory, 'bundle.zip'), contents, plan.signingFingerprint, keyring);
    assert(report.verified === true, 'Public verification was unsuccessful');
    await writeJson(join(directory, 'public-verification.json'), { ...report, planSha256: planHash });
    // Omit finish-run metadata so unchanged evidence and verification reproduce the same bytes.
    await writeJson(join(directory, 'release-report.json'), releaseReport(plan, contents, report, evidence, planHash));
  } finally { await rm(keyring, { recursive: true, force: true }); }
  await validatePlan(await readJson(join(directory, 'release-plan.json')), api);
  const marker = `<!-- allurx-build commit=${plan.commit} tag-object=${plan.tagObject} -->`;
  let release = await api.optional(`/releases/tags/${plan.tag}`);
  if (!release) {
    // GitHub prepends this body to the generated notes, preserving the release identity marker.
    release = await api.post('/releases', { tag_name: plan.tag, target_commitish: plan.commit, name: plan.tag,
      body: `${marker}\n\n`, generate_release_notes: true, draft: false, prerelease: false, make_latest: 'legacy' });
  } else {
    assert(str(release, 'tag_name') === plan.tag && release.draft === false && release.prerelease === false
      && str(release, 'body').includes(marker), 'Existing Release differs; manual review is required');
  }
  const assets = await api.pages(`/releases/${int(release, 'id')}/assets`);
  const legacy = new Set(['release-plan.json', 'manifest.json', 'public-verification.json']);
  assert(!assets.some(asset => legacy.has(str(asset, 'name'))),
    'Existing Release uses legacy evidence assets; preserve them and use the original shared workflow SHA to handle the original publication without redeploying');
  const missing: { name: string; data: Uint8Array }[] = [];
  for (const name of ['release-report.json', 'signing-public-key.asc']) {
    const matching = assets.filter(asset => str(asset, 'name') === name);
    const data = await readFile(join(directory, name));
    if (matching.length) {
      assert(matching.length === 1 && matching[0] && str(matching[0], 'digest') === `sha256:${await sha256(data)}`, `Existing Release asset differs: ${name}`);
    } else missing.push({ name, data });
  }
  // Check all existing attachments before adding any missing one.
  for (const { name, data } of missing) {
    const url = str(release, 'upload_url').split('{')[0];
    assert(url, 'Missing Release upload URL');
    await api.upload(`${url}?name=${encodeURIComponent(name)}`, data);
  }
  await output('release-url', str(release, 'html_url'));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (process.argv.length === 2 || command === '--help' && process.argv.length === 3) {
    console.log('allurx-build: prepare | deploy | finish\nGitHub Actions release tool; configuration uses environment variables.');
    return;
  }
  assert(process.argv.length === 3 && command && ['prepare', 'deploy', 'finish'].includes(command), 'Expected prepare, deploy or finish');
  const api = createGithub();
  const directory = resolve(env('RELEASE_DIR'));
  await mkdir(directory, { recursive: true });
  if (command === 'prepare') {
    const plan = await publicationPlan(api, directory);
    await writeJson(join(directory, 'release-plan.json'), plan);
    await output('version', plan.version);
    await output('commit', plan.commit);
  } else {
    const plan = await validatePlan(await readJson(join(directory, 'release-plan.json')), api);
    if (command === 'deploy') await deploy(api, directory, plan);
    else await finish(api, directory, plan);
  }
}

main().catch((error: unknown) => {
  console.error(`Release stopped: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
});
