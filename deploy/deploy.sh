#!/usr/bin/env bash
# 幂等发布脚本：把前端构建产物以版本目录落地，校验资源完整后再原子切换入口。
#
# 用法：
#   deploy.sh <dist目录> <部署根目录> [版本号]
#   KEEP_RELEASES=5 deploy.sh frontend/dist /srv/metric-insight-web
#
# 行为约定：
#   - 版本号缺省取 dist 内容哈希：同一内容永远得到同一版本号，重复部署是 no-op；
#   - 切换前先校验 index.html 引用的全部静态资源都已就位，
#     资源不齐则保持旧版本完整在线，绝不切换到半成品；
#   - 入口通过 current 软链原子替换（先建临时软链再 mv -T），
#     任何时刻 nginx 看到的都是完整一致的某一个版本；
#   - 旧版本目录保留 KEEP_RELEASES 个，回滚 = 把 current 指回旧版本。
set -euo pipefail

DIST="${1:?用法: deploy.sh <dist目录> <部署根目录> [版本号]}"
WEBROOT="${2:?缺少部署根目录}"
VERSION="${3:-}"
KEEP="${KEEP_RELEASES:-5}"

[ -d "$DIST" ] || { echo "dist 目录不存在：$DIST" >&2; exit 1; }
[ -f "$DIST/index.html" ] || { echo "dist 缺少 index.html，取消发布" >&2; exit 1; }

# ---- 1. 资源完整性校验：入口引用的每个本地资源都必须存在 ----
check_assets() {
  local dir="$1" missing=0 asset rel
  while IFS= read -r asset; do
    case "$asset" in
      http://*|https://*|//*) continue ;;                     # 外链不校验
      */assets/*) rel="assets/${asset#*/assets/}" ;;          # 剥掉部署前缀
      *) echo "  未知资源形态：$asset" >&2; missing=1; continue ;;
    esac
    if [ ! -f "$dir/$rel" ]; then
      echo "  缺少资源：$rel（被 index.html 引用）" >&2
      missing=1
    fi
  done < <(grep -oE '(src|href)="[^"]+"' "$dir/index.html" | sed -E 's/^(src|href)="([^"]+)"$/\2/')
  return "$missing"
}

echo "==> 校验构建产物资源完整性"
if ! check_assets "$DIST"; then
  echo "资源未就绪，保持当前线上版本不变，发布中止" >&2
  exit 1
fi

# ---- 2. 版本号：缺省取内容哈希，同内容同版本 ----
if [ -z "$VERSION" ]; then
  VERSION="$(cd "$DIST" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)"
fi
echo "==> 发布版本：$VERSION"

RELEASES="$WEBROOT/releases"
TARGET="$RELEASES/$VERSION"
mkdir -p "$RELEASES"

# ---- 3. 落地版本目录（已存在则跳过拷贝，幂等）----
if [ -f "$TARGET/index.html" ]; then
  echo "==> 版本目录已存在，跳过拷贝"
else
  TMP="$RELEASES/.tmp-$VERSION-$$"
  rm -rf "$TMP"
  mkdir -p "$TMP"
  cp -a "$DIST"/. "$TMP"/
  if ! check_assets "$TMP"; then
    rm -rf "$TMP"
    echo "落地后校验失败，保持当前线上版本不变" >&2
    exit 1
  fi
  mv "$TMP" "$TARGET"   # 同文件系统内原子出现
  echo "==> 版本目录已落地：$TARGET"
fi

# ---- 3.5 哈希资源汇入共享池：新旧版本的资源同时可访问 ----
# 缓存中的旧入口页面在 current 切换后仍能拉到配套旧资源，
# 不会出现“入口已新、资源已旧”的半新半旧状态。
POOL="$WEBROOT/assets-pool"
mkdir -p "$POOL"
if [ -d "$TARGET/assets" ]; then
  cp -rn "$TARGET/assets/." "$POOL/"   # 哈希命名：同名即同内容，增量合并不覆盖
fi

# ---- 4. 原子切换入口软链 ----
CURRENT_LINK="$WEBROOT/current"
if [ -L "$CURRENT_LINK" ] && [ "$(readlink "$CURRENT_LINK")" = "releases/$VERSION" ]; then
  echo "==> current 已指向该版本，无需切换（幂等 no-op）"
else
  ln -sfn "releases/$VERSION" "$WEBROOT/.current.tmp"
  mv -T "$WEBROOT/.current.tmp" "$CURRENT_LINK"
  echo "==> 入口已切换：current -> releases/$VERSION"
fi

# ---- 5. 清理过期版本（保留最近 KEEP 个，当前版本永不删）----
ls -1t "$RELEASES" | grep -v '^\.tmp' | tail -n "+$((KEEP + 1))" | while read -r old; do
  [ "$old" = "$VERSION" ] && continue
  rm -rf "${RELEASES:?}/$old"
  echo "==> 已清理旧版本：$old"
done

# ---- 6. 资源池对齐：只保留仍被保留版本引用的哈希资源 ----
shopt -s nullglob
for f in "$POOL"/*; do
  name="$(basename "$f")"
  keep=0
  for rel in "$RELEASES"/*/; do
    [ -f "${rel}assets/$name" ] && { keep=1; break; }
  done
  [ "$keep" = 0 ] && rm -f "$f"
done
shopt -u nullglob

echo "==> 发布完成：$VERSION"
