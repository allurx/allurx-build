# 发布指南

本文适用于已按 [README](../README.md) 接入的业务仓库。首次发布前先确认 [Maven 接入契约](maven-contract.md)，下文的 tag、commit 和工作流路径均指业务仓库，除非明确标注为共享工作流 SHA。

## 正式发布

1. 将整个 reactor 设置为同一个正式版本，如 `1.2.3`；提交非空的 `docs/releases/v1.2.3.md`，内容去除首尾空白后用作 GitHub Release 正文，并追加发布身份标记。
2. 将发布改动合入 `main`，确定最终发布 commit；检查该 commit 对应 `.github/workflows/ci.yml` 的最新 `main` push run 及其最新 attempt 已完成且成功。PR CI、`dev` CI 和手动 CI 不满足此门禁。
3. 在确认远端和目标 commit 后，创建直接指向该 commit 的 annotated tag，再只推送这个 tag。以下示例中的版本和 `<RELEASE_COMMIT_SHA>` 必须替换为实际值：

   ```sh
   git tag -a v1.2.3 <RELEASE_COMMIT_SHA> -m "Release v1.2.3"
   git push origin refs/tags/v1.2.3
   ```

4. 在 Actions 的 Release 运行中完成 Environment 审批（如有），等待发布和公开核验两个 job 成功，再检查生成的 GitHub Release 及附件。

工具要求发布 commit 在远端 `main` 的历史中，不要求它始终是最新 tip；tag 对象和它指向的 commit 都会记入计划，并在后续阶段重新核对。创建 tag 后不要移动、删除或重新创建它。

### 执行阶段

| 阶段 | 执行内容 | 通过后的结果 |
| --- | --- | --- |
| `prepare` | 检查 annotated tag、commit、精确 CI、重复发布和 release notes，生成并校验完整 effective POM | `release-plan.json` 上传到 Actions artifact，发生在 Central 上传之前 |
| `deploy` | 确认已归档计划，再查 CI 和重复发布，导出公钥，执行一次 `clean deploy` | 保留原 bundle、日志和部署证据；要求 Maven 成功且 Central 状态为 `PUBLISHED` |
| `finish` | 独立下载并核验公开文件、签名和 POM，重新确认 tag | 写入公开校验报告，创建或补全 GitHub Release |

构建使用发布 commit 的时间设置 `project.build.outputTimestamp`。CI 与发布会分别构建；公开校验比较的是**实际发布 bundle 与公开文件**，不声称 CI 和发布两次构建的字节完全一致。

仅有 Maven 返回成功、Central 显示 `PUBLISHED` 或 `version` output 都不足以表示整个流程完成，还需要公开核验和 GitHub Release 阶段成功。

## 失败后选择处理方式

先查看失败运行中 `Deploy once and wait for publication` 步骤的结论：

| 情况 | 处理方式 |
| --- | --- |
| 所有此前 attempt 的 deploy 步骤均唯一且明确为 `skipped` | 工具允许重跑原发布 run；先排除失败原因。源码问题需要新的提交和相应发布安排，重跑不会修改 tag 指向的源码 |
| deploy 已进入，或无法确认是否进入 | 停止自动重跑，人工核查原 deployment 和公开制品；不能把失败退出码视为“没有上传” |
| Central 已发布，但公开核验或 GitHub Release 失败 | 保留原部署，人工对照 bundle、公开文件和 Release 状态处理后续问题，不再次 deploy |
| 原计划、bundle、公钥或部署证据缺失、过期 | 收集剩余日志和 Central 信息，人工确认发布状态，不能通过重新构建替代原 bundle |

“Re-run all jobs” 只适用于能证明此前没有进入 deploy 的情况。只要之前进入过 deploy，或者步骤历史不足以排除上传，重复发布检查就会停止。删除重推 tag 也不能绕过同 tag 或同 commit 的历史检查。

## 核查 Central 状态

发生失败时，在原运行的 `maven-deploy.log`、`release-evidence.json` 和 Central Portal 中核对 deployment UUID 及 deployment name。日志只有恰好识别出一个不同的 deployment UUID 时才会自动记录；未记录 ID 不等于上传未发生。

工作流在 Maven 发布后核查 Central 状态，行为如下：

| 状态 | 当前行为 |
| --- | --- |
| `PENDING`、`VALIDATING`、`PUBLISHING` | Maven 成功退出后额外轮询最多 120 秒；Maven 失败后只查询一次，不继续等待 |
| `PUBLISHED` | 进入公开文件核验 |
| `VALIDATED` | 停止；这表示等待手动发布，与本流程自动发布的预期不符，需要调查 |
| `FAILED` 或其他未识别状态 | 停止，检查原部署错误和证据，人工处理 |

状态语义见 [Sonatype Publisher API](https://central.sonatype.org/publish/publish-portal-api/#verify-status-of-the-deployment)。未完整确认发布成功时，工作流停止并保留已生成的证据，不自动发起第二次部署。即使查询结果为 `PUBLISHED`，Maven 非零退出也会让本次发布 job 失败。

## 发布证据

Actions artifact 存放在**业务仓库对应运行**的 Artifacts 区域：

| Artifact | 主要内容 | 配置保留期 |
| --- | --- | --- |
| `release-plan-<attempt>` | `release-plan.json`：仓库、tag 对象、commit、原 run/attempt、共享 SHA、CI 记录、签名指纹和 reactor 模型 | 90 天 |
| `release-evidence-<attempt>` | 当时已生成的计划、`release-evidence.json`、`bundle.zip`、公钥、manifest，以及 effective POM 和 Maven 日志（如已生成） | 90 天 |
| `public-verification-<run_id>-<attempt>` | 已成功生成的 `public-verification.json` | 90 天 |

workflow 会在准备成功后尝试保存发布证据，包括后续失败的情况，但中断点可能导致部分文件尚未产生或未能上传。仅存在 artifact 名称不代表证据完整；公开校验报告也只有校验通过并写入后才存在。

成功的 GitHub Release 附带：

- `release-plan.json`。
- `manifest.json`，记录原 bundle 的 SHA-256 以及各文件路径、大小、类型和 SHA-256。
- `public-verification.json`。
- `signing-public-key.asc`。

bundle 和 Maven 日志保留在 Actions artifact 中，不上传为 Release 附件。排查问题时保留原 artifact；公开 Release 附件不包含完整构建日志和原 bundle。

### 已有 GitHub Release

首次创建时使用原发布 commit 中的 release notes，生成正式、非 draft、非 prerelease 的 Release，并追加绑定 commit 与 tag 对象的隐藏标记。

同 tag 的 Release 已存在时，工具要求该标记一致、Release 非 draft 且非 prerelease；仅补传缺失附件，并用 SHA-256 检查已有同名附件。它不会覆盖正文或替换不同内容的附件，也不会重新比较已存在正文与源 release notes 的全文。发现冲突会停止并要求人工核对。

## 常见停止原因

| 提示或现象 | 检查重点 |
| --- | --- |
| `A stable vMAJOR.MINOR.PATCH tag is required` / `Release requires an annotated tag` | tag 格式、tag 类型及是否直接指向 commit |
| `No main push CI run exists` / `Latest exact-commit main CI attempt is not completed/success` | `.github/workflows/ci.yml` 是否为同一发布 SHA 产生了成功的最新 main push CI；较早 attempt 成功不足以放行 |
| `Expected a fixed stable version` / `Unsupported production Central configuration` | [版本规则和 Central 插件配置](maven-contract.md)，尤其是父 POM、依赖和继承的插件配置 |
| `A previous deploy was entered or cannot be ruled out` | 收集原 run/attempt 的证据，人工确认发布状态；不要重复上传 |
| 共享工作流 SHA 与计划不符 | 同一次发布的工具版本发生变化，核对原计划及各 job 的引用 |
| `Required unique, unexpired artifact is unavailable` | deploy 前无法确认已归档的唯一发布计划，检查 artifact 上传步骤和保留状态 |
| `Remote tag moved after planning` | tag 身份与原记录冲突，需要人工核对 |
| `Public download did not verify after 6 attempts` | 公共仓库文件尚不可用、网络失败或内容不匹配；根据具体 URL 和原 manifest 核查，不重新上传 |
| `Existing Release differs` / `Existing Release asset differs` | 已有 Release 的标记、发布类型或附件摘要冲突，不自动覆盖 |

公开下载会对可重试错误最多尝试 6 次、间隔 10 秒，每次请求有超时。工作流不会在失败后持续后台监控，需人工确认后续状态。
