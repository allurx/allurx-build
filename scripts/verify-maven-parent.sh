#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(mktemp -d)"
trap 'rm -rf -- "$workspace"' EXIT
repository="$workspace/repository"

# 从隔离的本地仓库解析本次候选 parent。
mvn -B -ntp "-Dmaven.repo.local=$repository" -f "$root/maven-parent/pom.xml" clean install
cp -R "$root/templates/java-library" "$workspace/java-library"
cp -R "$root/templates/spring-boot-service" "$workspace/spring-boot-service"

# 验证普通消费者和类库附件，不签名或上传。
mvn -B -ntp "-Dmaven.repo.local=$repository" -f "$workspace/java-library/pom.xml" clean verify
mvn -B -ntp "-Dmaven.repo.local=$repository" -f "$workspace/java-library/pom.xml" -Prelease -Dgpg.skip=true clean verify
mvn -B -ntp "-Dmaven.repo.local=$repository" -f "$workspace/spring-boot-service/pom.xml" clean verify
