#!/usr/bin/env bash
# 离线合流验证：用 esbuild（nuxt 自带依赖）把 ~ 别名的 TS 源打包成 ESM，再用 node 跑断言。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test/.bundles

node --input-type=module <<'EOF'
import { build } from 'esbuild';
const alias = { '~': process.cwd() };
const common = {
  bundle: true, format: 'esm', platform: 'node',
  external: ['vue', 'pinia', '@vue/*', 'tdesign-vue-next'],
  alias, define: { 'import.meta.client': 'true' }, logLevel: 'silent'
};
await build({ ...common, entryPoints: ['utils/merge.ts'], outfile: 'test/.bundles/merge.mjs' });
await build({ ...common, entryPoints: ['store/dictionary.ts'], outfile: 'test/.bundles/store.mjs' });
EOF

node test/merge.check.mjs
