# allurx-build

English | [简体中文](README.zh-CN.md)

Shared build configuration, GitHub Actions, dependency update policies, and starter templates for Allurx projects. Adopt the components you need; using shared CI does not require the parent POM, configuration package, or a particular deployment method.

Component guides, detailed documentation, and template READMEs linked below are in Simplified Chinese.

| Task                                                                           | Entry point                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standardize compilation, testing, and release configuration for Java libraries | [Maven parent](maven-parent/README.md), available as `io.allurx:maven-parent` on Maven Central                                                                                    |
| Reuse ESLint, Prettier, TypeScript, or Vite configuration                      | [JS Config](js-config/README.md), available as `@allurx/js-config` on the npm registry                                                                                            |
| Verify Maven projects                                                          | [maven-ci.yml](.github/workflows/maven-ci.yml), which runs the project's `clean verify`                                                                                           |
| Verify Node.js projects                                                        | [Node integration guide](docs/node.md) and [node-ci.yml](.github/workflows/node-ci.yml)                                                                                           |
| Publish Maven or npm artifacts                                                 | [maven-central-publish.yml](.github/workflows/maven-central-publish.yml) and [npm-publish.yml](.github/workflows/npm-publish.yml); see the [release guide](docs/release-guide.md) |
| Deploy Cloudflare static sites                                                 | [cloudflare-static-site.yml](.github/workflows/cloudflare-static-site.yml); see the [deployment guide](docs/cloudflare-static-site.md)                                            |
| Update dependencies regularly                                                  | The root [Renovate preset](default.json); see the [dependency update guide](docs/dependency-updates.md)                                                                           |
| Start a project                                                                | [Project templates](templates/README.md)                                                                                                                                          |

Each project retains its business dependencies, modules, source scope, product builds, and deployment targets. A Spring Boot application can keep the official parent and adopt only shared Maven CI. A Node.js project can use the checking configuration without installing Vite or Wrangler.

<a name="接入工作流"></a>

## Integrating workflows

The shared workflows target GitHub.com. Maven and npm publishing use GitHub.com's [workflow identity context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#job-context) to pin the source of their helper tools. GitHub Enterprise Server is not supported.

The complete [Maven CI example](examples/ci.yml), [Maven release example](examples/release.yml), and [static site template](templates/static-site/README.md) are pinned to the full commit SHA of the published [workflows v1.0.0](https://github.com/allurx/allurx-build/releases/tag/workflows-v1.0.0) release. Copy an example and configure the project's branches, release conditions, and deployment targets; there is no need to look up that SHA again.

Short documentation snippets use `WORKFLOWS_COMMIT_SHA` as a placeholder for the workflow version. To write a caller yourself or select another release:

1. Choose a published `workflows-vX.Y.Z` tag containing the required workflows from [Releases](https://github.com/allurx/allurx-build/releases).
2. Replace `WORKFLOW_TAG` below with the selected tag to obtain its full 40-character commit SHA:

    ```sh
    gh api repos/allurx/allurx-build/commits/WORKFLOW_TAG --jq .sha
    ```

3. Use that SHA for `WORKFLOWS_COMMIT_SHA` in a snippet, or replace the `uses` SHA in a copied file. Record the corresponding tag in a comment on the same line. Placeholders are not runnable references.

Example shared Maven verification job:

```yaml
jobs:
    verify:
        uses: allurx/allurx-build/.github/workflows/maven-ci.yml@WORKFLOWS_COMMIT_SHA
```

The caller defines events, permissions, and concurrency. Keep project-specific checks in their own jobs. Release branches protected by pull requests should require every necessary check, including additional integration or browser tests. Direct-push workflows and development branches retain their existing rules; adopting shared CI does not require mandatory pull requests or new bypass rules. All required CI checks must still pass.

The configuration package, parent POM, and workflows have independent versions. Install exact versions that are actually published in the registry, and review workflow upgrades as SHA changes. Do not use branch names as version identifiers for reproducible installation or publishing.

## Local maintenance

Use the Node.js version in [.node-version](.node-version). The root project manages [js-config](js-config/package.json) through npm workspaces. The Maven distribution version and checksum are maintained in [setup-maven](actions/setup-maven/action.yml); Java build requirements are defined by the [parent POM](maven-parent/pom.xml).

From the repository root, run:

```sh
npm ci --ignore-scripts
npm run verify
bash scripts/verify-maven-parent.sh
```

Node.js runs the release tools and their tests directly from TypeScript. The root `build` only builds JS Config. The configuration package independently cleans and generates its JavaScript and type declarations; `prepack` also runs that build first. Node verification includes the release tool checks and consumer tests using a real configuration package tarball.

Signing tests require executable `gpg` and `gpgconf` commands. On Windows, use native GnuPG and put its `bin` directory before Git/MSYS directories in `PATH`. The Bash integration tests for upload safeguards must run in Linux CI. On Windows, set `ALLURX_TEST_BASH` to Git Bash and provide `jq` in `PATH`; without an explicit Bash path, that test is marked as skipped. The Java verification script uses Bash, installs the candidate parent into an isolated Maven repository, and verifies the Java library and Spring Boot service templates. Actual products still need their own compilation, JPMS, tests, and artifact checks. See [ci.yml](.github/workflows/ci.yml) for the complete CI entry point.

To publish a component from this repository, select it under **Actions → Release build infrastructure**. The workflow reuses the complete CI checks before reading the version from the reviewed manifest and creating the tag. See the [release guide](docs/release-guide.md) for the procedure and failure recovery. Local checks do not verify GitHub Environments, npm Trusted Publisher configuration, Central credentials, or production deployments.

## License

[Apache-2.0](LICENSE.txt).
