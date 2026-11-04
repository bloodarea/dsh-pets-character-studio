#!/usr/bin/env bash
# ===========================================================================
# 安装本地 git 钩子（钩子本身不随仓库分发，故每个克隆执行一次）。
# 目前只装 pre-commit：调用 scripts/verify-hygiene.sh 检查暂存区。
# 幂等：重复执行会覆盖为本仓库的标准钩子。
# ===========================================================================
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
hooks_dir=$(git rev-parse --git-dir)/hooks
mkdir -p "$hooks_dir"

cat > "$hooks_dir/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# 由 scripts/install-hooks.sh 安装；检查暂存区是否符合文件卫生规则。
root=$(git rev-parse --show-toplevel) || exit 0
[ -x "$root/scripts/verify-hygiene.sh" ] || exit 0
exec "$root/scripts/verify-hygiene.sh"
HOOK

chmod +x "$hooks_dir/pre-commit"
echo "已安装 pre-commit 钩子：$hooks_dir/pre-commit"
echo "自检：scripts/verify-hygiene.sh --all"
