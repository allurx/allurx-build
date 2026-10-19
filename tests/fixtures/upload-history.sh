#!/usr/bin/env bash
# Copyright 2026 allurx
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# 只替换 GitHub 与 tag 查询，实际保护逻辑和 jq 处理仍由共享脚本执行。
gh() {
    [[ "$1" == api ]] || return 90
    if [[ "${ALLURX_TEST_WORKFLOWS_RELEASE:-}" == 1 ]]; then
        printf '%s\n' "$*" >> calls
        case "$2" in
            "repos/$GITHUB_REPOSITORY/git/ref/tags/$RELEASE_TAG")
                [[ "$3" == --jq ]] || return 91
                printf 'tag-object\n'
                ;;
            "repos/$GITHUB_REPOSITORY/git/tags/tag-object")
                [[ "$3" == --jq ]] || return 91
                printf '%s\n' "$GITHUB_SHA"
                ;;
            "repos/$GITHUB_REPOSITORY/releases")
                [[ "$3" == --paginate ]] || return 91
                if [[ -f list-error ]]; then
                    echo 'GitHub release list request failed' >&2
                    return 1
                fi
                cat releases.json
                ;;
            --method)
                [[ "$3" == POST && "$4" == "repos/$GITHUB_REPOSITORY/releases" ]] || return 91
                cp created-release.json release-by-id.json
                if [[ -f create-error ]]; then
                    echo 'Connection lost after creating Release' >&2
                    return 1
                fi
                cat created-release.json
                ;;
            "repos/$GITHUB_REPOSITORY/releases/17")
                cat release-by-id.json
                ;;
            *) return 91 ;;
        esac
        return
    fi
    printf '%s\n' "$2" >> calls
    if [[ "${ALLURX_TEST_RELEASE_GUARD:-}" == 1 ]]; then
        if [[ "$2" =~ /runs/([0-9]+)/attempts/([0-9]+)/jobs$ ]]; then
            [[ "$3" == --paginate ]] || return 91
            cat "run-${BASH_REMATCH[1]}-attempt-${BASH_REMATCH[2]}.json"
        elif [[ "$2" =~ /runs/([0-9]+)$ ]]; then
            [[ "$3" == --jq && "$4" == .run_attempt ]] || return 91
            cat "run-${BASH_REMATCH[1]}-attempt.txt"
        else
            return 91
        fi
    else
        [[ "$3" == --paginate && "$2" =~ /attempts/([0-9]+)/jobs$ ]] || return 91
        cat "attempt-${BASH_REMATCH[1]}.json"
    fi
}

git() {
    [[ "$1" == -C && "$2" == project && "$3" == for-each-ref ]] || return 92
    cat annotation.txt
}

export -f gh git
if [[ "${2:-}" == workflows ]]; then
    export ALLURX_TEST_WORKFLOWS_RELEASE=1
    bash "$1"
elif [[ "${2:-}" == release ]]; then
    export ALLURX_TEST_RELEASE_GUARD=1
    bash "$1"
else
    bash "$1" 'Publish retained package' 'Upload package' project
fi
