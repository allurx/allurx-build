# 发布指南

## 发布步骤

1. 将整个 reactor 的统一正式版本合入调用方 `main`，确认发布 commit 对应 `.github/workflows/ci.yml` 的**最新 main push run 及其最新 attempt 成功**；PR、dev、手动 CI 不满足门禁。
2. 创建直接指向发布 commit 的 annotated tag，再推送该 tag。替换示例中的版本与 SHA：

   ```sh
   git tag -a v1.2.3 <RELEASE_COMMIT_SHA> -m "Release v1.2.3"
   git push origin refs/tags/v1.2.3
   ```

3. 完成 Environment 审批（如有），等待发布和公开核验两个 job 成功，并检查 GitHub Release 及附件。

发布 commit 必须位于远端 `main` 历史中，不必始终是最新 tip；tag 对象、commit 和共享工具 SHA 在各阶段须与计划一致，不能移动或重建 tag，也不能跨工具版本重跑旧计划。

| 阶段 | 行为 |
| --- | --- |
| `prepare` | 校验 tag、commit、精确 CI、重复发布和 effective POM；先将计划归档到 Actions，再允许上传 Central |
| `deploy` | 下载归档计划核对摘要，复查 CI、重复发布和源码；执行一次签名 `clean deploy`，保留原 bundle 与日志；要求 Maven 成功且 Central 为 `PUBLISHED` |
| `finish` | 独立 job 从 `https://repo.maven.apache.org/maven2` 下载 manifest 中每个文件，核对大小、SHA-256、签名及 POM/父 POM 元数据；再确认 tag，生成报告并创建或补全 Release |

构建以提交时间设置 `project.build.outputTimestamp`。公开核验比较原发布 bundle 与公开文件，不依赖搜索索引，也不能证明 CI 与发布两次构建的字节一致。Maven 成功、`PUBLISHED` 或准备阶段 outputs 均不能单独证明整个流程完成。

## 证据与 GitHub Release

调用方运行中的 Actions artifacts 配置保留 **90 天**：

| Artifact | 内容 |
| --- | --- |
| `release-plan-<attempt>` | `release-plan.json`：发布身份、原 run/attempt、共享 SHA、CI、签名指纹和 reactor 模型 |
| `release-evidence-<attempt>` | 计划、`release-evidence.json`、`bundle.zip`、公钥、`manifest.json`、effective POM 和 Maven 日志（以已生成为准） |
| `public-verification-<run_id>-<attempt>` | 核验成功后生成的内部 `public-verification.json` 和汇总 `release-report.json` |

准备成功后，即使后续失败也会尝试归档；中断可能导致文件未产生或未上传，artifact 名称不能证明证据完整。原 bundle 和日志只保留在 Actions artifact 中。

GitHub Release 的公开证据附件仅为 **`release-report.json` 与 `signing-public-key.asc`**。汇总报告包含：

| 分组 | 内容 |
| --- | --- |
| `release` | 仓库、版本、tag、tag 对象、commit |
| `provenance` | 原 run/attempt、CI、共享 SHA、构建输出时间戳、计划和 effective POM 摘要 |
| `publication` | deployment ID/name、`PUBLISHED`、原 bundle SHA-256、公共仓库地址 |
| `signing` | 主公钥指纹、公钥文件名 |
| `artifacts` | 模块 groupId/artifactId/packaging（共用发布版本）；一份完整文件清单：path/size/kind/sha256 |
| `verification` | 核验结果、主体/文件/签名计数、外部父 POM |

首次创建时用 `generate_release_notes` [自动生成发布说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)，无需逐版本说明文件；标题为 tag，非 draft、非 prerelease，正文前置绑定 commit 与 tag 对象的隐藏标记。

已有 Release 必须保持上述身份和发布类型。工具先核对全部已有目标附件的 SHA-256，再补缺失附件，不覆盖正文或冲突附件。若含旧版 `release-plan.json`、`manifest.json` 或 `public-verification.json` 公开附件，新版 `finish` 停止；按原工具版本和原证据处理，不自动混用、迁移或删除旧附件。此格式变化不改变 Central 制品。

## 失败判断

先检查原运行的 `Deploy once and wait for publication` 步骤：

| 情况 | 处理 |
| --- | --- |
| 所有此前 attempt 的 deploy 步骤均唯一且明确为 `skipped` | 排除原因后可完整重跑；源码仍为原 tag 指向的 commit |
| deploy 已进入，或历史不足以排除进入 | 停止重部署，人工核查原 deployment 和公开制品；非零退出码不证明未上传 |
| Central 已发布，后续核验或 Release 失败 | 保留原部署，依据原证据处理失败阶段，不再次 deploy |
| 原计划、bundle、公钥或部署证据缺失/过期 | 收集剩余日志与 Central 状态人工核查，不以重新构建替代原 bundle |

同 tag 或同 commit 的其他发布 run 也会检查，删除重推 tag 无法绕过历史。

从 `maven-deploy.log`、`release-evidence.json` 和 Central Portal 核对 deployment UUID/name。日志仅识别出一个不同 UUID 时才自动记录；缺失 ID 不代表未上传。Maven 成功后对 `PENDING`、`VALIDATING`、`PUBLISHING` 额外轮询最多 120 秒，失败后仅查询一次；`VALIDATED`、`FAILED` 或未知状态均停止流程并要求调查，只有 Maven 成功且 `PUBLISHED` 才允许后续 job。

公开下载对可重试错误最多尝试 6 次，间隔 10 秒，每次有超时；耗尽后依据原 manifest 核对具体 URL、网络和内容，不重新上传。工作流停止后不会持续后台监控。
