#!/usr/bin/env bash
# Copyright 2026 allurx
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(mktemp -d)"
trap 'rm -rf -- "$workspace"' EXIT
repository="$workspace/repository"

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

maven() {
    mvn -B -ntp "-Dmaven.repo.local=$repository" "$@"
}

# 直接比较实际归档中的字节；不把资源目录存在或 Maven 成功等同于随包交付。
archive_index=0
assert_archives() {
    local module="$1" notices="$2" kind="$3" expected_count="$4"
    local archive extracted entries document count=0 matches
    for archive in "$module"/target/*.jar; do
        [[ -f "$archive" ]] || fail "未生成 JAR：$module"
        count=$((count + 1))
        archive_index=$((archive_index + 1))
        extracted="$workspace/archives/$archive_index"
        mkdir -p "$extracted"
        entries="$extracted/entries.txt"
        jar --list --file "$archive" | tr -d '\r' > "$entries"
        jar --extract --file "$archive" --dir "$extracted"

        for document in LICENSE.txt NOTICE.txt THIRD-PARTY-NOTICES.txt; do
            matches="$(awk -v entry="META-INF/$document" '$0 == entry { count++ } END { print count + 0 }' "$entries")"
            if [[ -f "$notices/$document" ]]; then
                [[ "$matches" == 1 ]] || fail "$archive 必须恰好包含一份 META-INF/$document"
                cmp "$notices/$document" "$extracted/META-INF/$document" || fail "$archive 改变了 $document 的字节"
            else
                [[ "$matches" == 0 ]] || fail "$archive 不应生成不存在的 $document"
            fi
        done

        if [[ "$kind" == starter ]]; then
            cmp "$module/README.md" "$extracted/README.md" || fail "$archive 丢失 starter 文档"
            [[ ! -f "$extracted/index.html" ]] || fail "$archive 不应为无源码 starter 生成 API 文档"
        elif [[ "$archive" == *-javadoc.jar ]]; then
            [[ -f "$extracted/index.html" ]] || fail "$archive 丢失 Javadoc 首页"
            [[ -d "$extracted/legal" ]] || fail "$archive 丢失 Javadoc 自带的许可声明"
            diff -r "$module/target/reports/apidocs/legal" "$extracted/legal" || fail "$archive 改变了 Javadoc 自带的许可声明"
        else
            cmp "$module/src/main/resources/probe.txt" "$extracted/probe.txt" || fail "$archive 丢失普通资源"
            if [[ "$archive" == *-sources.jar ]]; then
                cmp "$module/src/main/java/example/library/Library.java" "$extracted/example/library/Library.java" || fail "$archive 丢失源码"
            else
                [[ -f "$extracted/example/library/Library.class" ]] || fail "$archive 丢失编译结果"
            fi
        fi
    done
    [[ "$count" == "$expected_count" ]] || fail "$module 应生成 $expected_count 个 JAR，实际为 $count"
    printf '已核对 %s：%s 个 JAR 的内容与许可字节。\n' "$module" "$count"
}

# 从隔离的本地仓库解析本次候选 parent。
maven -f "$root/maven-parent/pom.xml" clean install
candidate_version="$(mvn -q -ntp "-Dmaven.repo.local=$repository" -f "$root/maven-parent/pom.xml" help:evaluate -Dexpression=project.version -DforceStdout -Dstyle.color=never)"
[[ "$candidate_version" =~ ^[[:alnum:]._-]+$ ]] || fail "无法读取候选 parent 版本：$candidate_version"
cp -R "$root/templates/java-library" "$workspace/java-library"
cp -R "$root/templates/spring-boot-service" "$workspace/spring-boot-service"

# 正式模板继续引用已发布版本；临时副本始终验证当前候选，不预先要求发布。
library="$workspace/java-library"
sed "/<parent>/,/<\/parent>/s|<version>[^<]*</version>|<version>$candidate_version</version>|" "$library/pom.xml" > "$library/pom.xml.new"
mv "$library/pom.xml.new" "$library/pom.xml"
mkdir -p "$library/src/main/resources"
printf '普通资源，不应被许可配置覆盖。\r\n' > "$library/src/main/resources/probe.txt"

# 单模块：普通构建只产主包；release 附件仍不签名或上传。没有 NOTICE 时不生成占位文件。
maven -f "$library/pom.xml" clean verify
assert_archives "$library" "$library" java 1
maven -f "$library/pom.xml" -Prelease -Dgpg.skip=true clean verify
assert_archives "$library" "$library" java 3

# 一套小反应堆覆盖根许可、深层模块独立许可和无 Java 源码的 starter。
reactor="$workspace/reactor"
mkdir -p "$reactor/library" "$reactor/group/custom/legal" "$reactor/starter"
cp -R "$library/.mvn" "$reactor/.mvn"
cp "$library/LICENSE.txt" "$reactor/LICENSE.txt"
printf '根 NOTICE：保留 CRLF。\r\n' > "$reactor/NOTICE.txt"
printf '第三方声明测试资源。\n' > "$reactor/THIRD-PARTY-NOTICES.txt"
cp -R "$library/src" "$reactor/library/src"
cp -R "$library/src" "$reactor/group/custom/src"
{
    printf '模块专有许可来源测试。\r\n\r\n'
    cat "$library/LICENSE.txt"
} > "$reactor/group/custom/legal/LICENSE.txt"
printf '模块专有 NOTICE。\n' > "$reactor/group/custom/legal/NOTICE.txt"
printf '# Starter\n\n本模块不包含 Java 源码，附件交付这份使用说明。\n' > "$reactor/starter/README.md"

cat > "$reactor/pom.xml" <<EOF
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>io.allurx</groupId>
        <artifactId>maven-parent</artifactId>
        <version>$candidate_version</version>
        <relativePath/>
    </parent>
    <groupId>example.license</groupId>
    <artifactId>reactor</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>
    <modules>
        <module>library</module>
        <module>group</module>
        <module>starter</module>
    </modules>
</project>
EOF

cat > "$reactor/library/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>example.license</groupId>
        <artifactId>reactor</artifactId>
        <version>1.0.0</version>
    </parent>
    <artifactId>library</artifactId>
</project>
EOF

cat > "$reactor/group/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>example.license</groupId>
        <artifactId>reactor</artifactId>
        <version>1.0.0</version>
    </parent>
    <artifactId>group</artifactId>
    <packaging>pom</packaging>
    <modules><module>custom</module></modules>
</project>
EOF

cat > "$reactor/group/custom/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>example.license</groupId>
        <artifactId>group</artifactId>
        <version>1.0.0</version>
    </parent>
    <artifactId>custom</artifactId>
    <properties>
        <allurx.license.directory>${project.basedir}/legal</allurx.license.directory>
    </properties>
</project>
EOF

cat > "$reactor/starter/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>example.license</groupId>
        <artifactId>reactor</artifactId>
        <version>1.0.0</version>
    </parent>
    <artifactId>starter</artifactId>
    <build>
        <resources>
            <resource>
                <directory>${project.basedir}</directory>
                <includes><include>README.md</include></includes>
            </resource>
            <resource>
                <directory>${project.build.directory}/maven-shared-archive-resources</directory>
            </resource>
        </resources>
    </build>
    <profiles>
        <profile>
            <id>release</id>
            <build>
                <plugins>
                    <plugin>
                        <groupId>org.apache.maven.plugins</groupId>
                        <artifactId>maven-jar-plugin</artifactId>
                        <executions>
                            <execution>
                                <id>attach-starter-javadoc</id>
                                <phase>package</phase>
                                <goals><goal>jar</goal></goals>
                                <configuration><classifier>javadoc</classifier></configuration>
                            </execution>
                        </executions>
                    </plugin>
                </plugins>
            </build>
        </profile>
    </profiles>
</project>
EOF

(
    cd "$reactor"
    maven -Prelease -Dgpg.skip=true clean verify
)
assert_archives "$reactor/library" "$reactor" java 3
assert_archives "$reactor/group/custom" "$reactor/group/custom/legal" java 3
assert_archives "$reactor/starter" "$reactor" starter 3

# -pl 不带 -am 会改变 session.topLevelProject；许可来源仍须保持在 .mvn 标记的根目录。
(
    cd "$reactor"
    maven -pl library -Prelease -Dgpg.skip=true clean verify
)
assert_archives "$reactor/library" "$reactor" java 3
(
    cd "$reactor"
    maven -pl group/custom -am -Prelease -Dgpg.skip=true clean verify
)
assert_archives "$reactor/group/custom" "$reactor/group/custom/legal" java 3

for module in library group/custom starter; do
    (
        cd "$reactor/$module"
        maven -Prelease -Dgpg.skip=true clean verify
    )
    if [[ "$module" == group/custom ]]; then
        assert_archives "$reactor/$module" "$reactor/$module/legal" java 3
    elif [[ "$module" == starter ]]; then
        assert_archives "$reactor/$module" "$reactor" starter 3
    else
        assert_archives "$reactor/$module" "$reactor" java 3
    fi
done
(
    cd "$workspace"
    maven -f reactor/library/pom.xml -Prelease -Dgpg.skip=true clean verify
)
assert_archives "$reactor/library" "$reactor" java 3

# 缺少维护源必须由许可规则明确拒绝，不能把依赖解析等其他失败误判为通过。
missing="$workspace/missing-license"
mkdir -p "$missing"
cp "$library/pom.xml" "$missing/pom.xml"
cp -R "$library/.mvn" "$missing/.mvn"
if maven -f "$missing/pom.xml" clean verify > "$workspace/missing-license.log" 2>&1; then
    fail '缺少 LICENSE.txt 的消费者竟然通过了构建'
fi
grep -Fq 'Some required files are missing' "$workspace/missing-license.log" || {
    cat "$workspace/missing-license.log"
    fail '缺少 LICENSE.txt 的失败不是预期的许可规则错误'
}
grep -Fq 'LICENSE.txt' "$workspace/missing-license.log" || fail '许可错误没有说明缺失文件'
printf '已核对缺少 LICENSE.txt 时明确失败。\n'

# Spring Boot 模板继续使用自己的 parent 和交付方式。
maven -f "$workspace/spring-boot-service/pom.xml" clean verify
