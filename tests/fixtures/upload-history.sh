#!/usr/bin/env bash
set -euo pipefail

# 只替换 GitHub 与 tag 查询，实际保护逻辑和 jq 处理仍由共享脚本执行。
gh() {
    [[ "$1" == api && "$3" == --paginate ]] || return 90
    printf '%s\n' "$2" >> calls
    [[ "$2" =~ /attempts/([0-9]+)/jobs$ ]] || return 91
    cat "attempt-${BASH_REMATCH[1]}.json"
}

git() {
    [[ "$1" == -C && "$2" == project && "$3" == for-each-ref ]] || return 92
    cat annotation.txt
}

export -f gh git
bash "$1" 'Publish retained package' 'Upload package' project
