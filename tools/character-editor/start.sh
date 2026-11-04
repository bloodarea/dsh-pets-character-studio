#!/usr/bin/env bash
# 启动「内置人物包管理器」：起本地静态服务并打开浏览器。
#
#   ./start.sh                  # 默认 8123，占用则自动往后找
#   ./start.sh --port 9000      # 指定端口
#   ./start.sh --no-browser     # 只起服务
#   端口被本工具旧实例占着：先结束它再接管；被别的程序占着：换空闲端口
#   --no-restart 不结束旧实例；--strict-port 端口被占就报错退出
#
# 依赖：Python 3（标准库即可，无需 pip 安装任何东西）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "未找到 python3 / python，请先安装 Python 3 并加入 PATH。" >&2
  exit 1
fi

exec "$PY" "$HERE/serve.py" "$@"
