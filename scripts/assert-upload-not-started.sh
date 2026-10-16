#!/usr/bin/env bash
set -euo pipefail

publish_job="$1"
upload_step="$2"
source_directory="$3"
first_attempt=1

# 组件 tag 可能在前一次验证失败后的重试中才创建，只检查该 tag 创建后的上传记录。
annotation="$(git -C "$source_directory" for-each-ref --format='%(contents)' "refs/tags/$RELEASE_TAG")"
created_attempt="$(sed -n 's/^Created in attempt: //p' <<< "$annotation")"
if grep -Fxq "Workflow run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" <<< "$annotation" \
    && [[ "$created_attempt" =~ ^[1-9][0-9]*$ ]] && (( created_attempt <= GITHUB_RUN_ATTEMPT )); then
    first_attempt="$created_attempt"
fi

for ((attempt = first_attempt; attempt < GITHUB_RUN_ATTEMPT; attempt++)); do
    if ! gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$attempt/jobs" --paginate |
        jq -se --arg job "$publish_job" --arg step "$upload_step" '
            [.[].jobs[] | select(.name == $job or (.name | endswith(" / " + $job)))]
            | length == 1 and (.[0].conclusion == "skipped"
                or ([.[0].steps[]? | select(.name == $step)]
                    | length == 1 and .[0].conclusion == "skipped"))
        '; then
        echo 'A previous upload was entered or cannot be ruled out. Recover the retained artifact and inspect the original publication; do not rebuild or upload again.' >&2
        exit 1
    fi
done
