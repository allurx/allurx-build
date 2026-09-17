# 发布指南

## 发布步骤

首次发布前完成 [接入和凭据配置](../README.md#接入)。以下操作在调用方仓库执行，本地验证遵循其开发说明。

1. 统一整个 reactor 的正式版本，完成本地验证，将变更合入 `main`。长期 `dev` 分支遵循下方约定。
2. 在干净的 `main` checkout 中执行 `git pull --ff-only`。核对发布 commit 位于远端 `main` 历史中、POM 版本与待发布版本一致，且该 commit 对应 `.github/workflows/ci.yml` 的**最新 main push run 及其最新 attempt 成功**。
3. 创建并推送直接指向该 commit 的 annotated tag。将 `1.2.3` 替换为正式版本，`<RELEASE_COMMIT_SHA>` 替换为已核验的完整 SHA：

   ```sh
   git tag -a v1.2.3 <RELEASE_COMMIT_SHA> -m "Release v1.2.3"
   git push origin refs/tags/v1.2.3
   ```

4. 在 **Actions → Release** 中完成 Environment 审批（如有）。待发布和公开核验两个 job 成功后，核对 GitHub Release 的 tag、commit 和证据附件；审阅自动生成的说明，为破坏性变更补充迁移指引。
5. 将已核验的发布 commit 同步回长期 `dev` 分支（如有）；若 `dev` 有更新，推送并检查其 CI。

### 长期分支约定

以下操作由维护者执行，共享工作流不自动合并或同步分支。

| 集成方向 | 方式 |
| --- | --- |
| 短期功能、修复或依赖更新分支 → `dev` | `Squash and merge` |
| `dev` → `main` 的发布 PR | `Create a merge commit`，保留长期分支的祖先关系 |
| 已核验的发布 commit → `dev` | 已包含则跳过；可快进则快进；分叉时普通合并并保留后续改动 |

## 执行阶段

| 阶段 | 行为 |
| --- | --- |
| `prepare` | 校验发布身份、精确 CI 和 effective POM，排除重复部署；计划归档到 Actions 后才允许部署 |
| `deploy` | 核对归档计划摘要，复查 CI、源码和重复部署；执行一次签名 `clean deploy`，保留原 bundle 与日志；要求 Maven 成功且 Central 为 `PUBLISHED` |
| `finish` | 独立 job 从 `https://repo.maven.apache.org/maven2` 逐一下载 manifest 中的文件，核验大小、SHA-256、签名及 POM/父 POM 元数据；再确认 tag，生成报告并创建或补全 Release |

构建以提交时间设置 `project.build.outputTimestamp`。公开核验比较原发布 bundle 与公开文件，不依赖搜索索引。

### 注意事项

- PR、dev、手动 CI 不满足发布门禁。
- 发布 commit 不必是 `main` 最新 tip；tag 对象、commit 和共享工具 SHA 须始终与计划一致，不能移动或重建 tag，也不能跨工具版本重跑旧计划。
- 已有计划沿用保存的 `deploymentName`，不重新生成。
- 公开核验不能证明 CI 与发布两次构建的字节一致；Maven 成功、`PUBLISHED` 或准备阶段 outputs 均不能单独证明整个流程完成。

## 证据与 GitHub Release

调用方发布运行中的 Actions artifacts 配置保留 **90 天**：

| Artifact | 内容 |
| --- | --- |
| `release-plan-<attempt>` | `release-plan.json`：发布身份、原 run/attempt、共享 SHA、CI、签名指纹和 reactor 模型 |
| `release-evidence-<attempt>` | 计划、`release-evidence.json`、`bundle.zip`、公钥、`manifest.json`、effective POM 和 Maven 日志（以已生成为准） |
| `public-verification-<run_id>-<attempt>` | 核验成功后生成的内部 `public-verification.json` 和汇总 `release-report.json` |

准备成功后，后续失败也会尝试归档。原 bundle 和日志仅存于 Actions artifact。

GitHub Release 的公开证据附件为 **`release-report.json` 与 `signing-public-key.asc`**。报告汇总发布身份、原 run/attempt、CI 与共享 SHA、部署与签名信息、完整制品清单及核验结果。

新 Release 以 tag 为标题，[自动生成说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)，无需逐版本说明文件；类型为正式发布，正文保留绑定 commit 与 tag 对象的隐藏标记。

已有 Release 先核对全部目标附件的 SHA-256，再补缺失附件。

### 注意事项

- 中断可能导致文件未产生或未上传，artifact 名称不能证明证据完整。
- 已有 Release 必须保持上述身份，且不能为 draft 或 prerelease；工具不覆盖正文或冲突附件。
- 若含旧版公开附件 `release-plan.json`、`manifest.json` 或 `public-verification.json`，新版 `finish` 停止。须使用原工具版本和原证据，不自动混用、迁移或删除旧附件；Central 制品不受影响。

## 失败判断

先检查原运行的 `Deploy once and wait for publication` 步骤：

| 情况 | 处理 |
| --- | --- |
| 所有此前 attempt 的 deploy 步骤均唯一且明确为 `skipped` | 排除原因后可完整重跑，仍使用原 tag 指向的 commit |
| deploy 已进入，或历史不足以排除进入 | 停止重部署，核查原 deployment 和公开制品；非零退出码不证明未上传 |
| Central 已发布，后续核验或 Release 失败 | 保留原部署，按原证据处理失败阶段，不再次 deploy |
| 原计划、bundle、公钥或部署证据缺失/过期 | 人工核查剩余日志与 Central 状态，不以重新构建替代原 bundle |

从 `maven-deploy.log`、`release-evidence.json` 和 Central Portal 核对 deployment UUID/name。新计划的 `deploymentName` 为 `<repository>-<version>`；精确查询使用 deployment ID，仅在日志中识别到唯一 UUID 时自动记录。

Maven 成功后，对 `PENDING`、`VALIDATING`、`PUBLISHING` 额外轮询最多 120 秒；失败后仅查询一次。`VALIDATED`、`FAILED` 或未知状态均停止流程，需人工调查。

公开下载遇可重试错误最多尝试 6 次，间隔 10 秒，每次有超时；耗尽后按原 manifest 核查 URL、网络和内容。

### 注意事项

- 同 tag 或同 commit 的其他发布 run 也会检查，删除重推 tag 无法绕过历史。
- 缺失 deployment ID 不代表未上传；公开下载重试耗尽后不重新上传。
- 工作流停止后不会持续后台监控。
