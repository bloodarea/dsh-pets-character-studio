// Node 下跑 core + bundle 自测（仓库 package.json 是 ESM，故用 .mjs）
import './core.js';
import './bundle.js';
import './selftest.js';
const r = globalThis.__selftestResult;
if (!r) {
  console.error('自测没有产出结果');
  process.exit(1);
}
console.log(`\n${r.total - r.failed}/${r.total} passed`);
process.exit(r.failed ? 1 : 0);