#!/bin/bash
# 双击打开当前运行模式对应的地址；仅管理本脚本启动的进程。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
NODE="${ATLAS_NODE:-$(command -v node || true)}"
if [ ! -x "$NODE" ]; then
  for candidate in /Users/lrwei91/.hermes/node/bin/node /Users/lrwei91/.workbuddy/binaries/node/versions/22.22.2-5/bin/node; do
    if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi
if [ ! -x "$NODE" ]; then echo "未找到 Node.js，服务未启动。"; exit 1; fi
BASE="${ATLAS_LOCAL_URL:-http://127.0.0.1:4317}"
ENTRY_URL=""
ready() {
  local status
  status=$(curl --fail --silent --max-time 2 "$BASE/auth/status") || return 1
  ENTRY_URL=$(printf '%s' "$status" | "$NODE" -e '
    let data="";
    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => {
      try {
        const status = JSON.parse(data);
        if (typeof status.setupRequired !== "boolean" || typeof status.authenticated !== "boolean") process.exit(1);
        const url = new URL(status.publicUrl || process.argv[1]);
        if (!["http:", "https:"].includes(url.protocol)) process.exit(1);
        process.stdout.write(url.origin + "/");
      } catch { process.exit(1); }
    });
  ' "$BASE") || return 1
}
if ready; then
  echo "工作台已在运行：$ENTRY_URL"
  open "$ENTRY_URL"
  exit $?
fi
"$NODE" server.js &
ATLAS_CHILD=$!
cleanup() { kill "$ATLAS_CHILD" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 0' HUP INT TERM
for attempt in {1..40}; do
  if ! kill -0 "$ATLAS_CHILD" 2>/dev/null; then
    echo "Atlas 启动失败，请检查上方错误。"; wait "$ATLAS_CHILD"; exit 1
  fi
  if ready; then
    echo "已启动：$ENTRY_URL（关闭本窗口即停止本次启动的服务）"
    open "$ENTRY_URL"
    wait "$ATLAS_CHILD"
    exit $?
  fi
  sleep 0.25
done
echo "Atlas 未在预期地址就绪：$BASE"
exit 1
