// 合流逻辑与多页保存的离线验证：bash test/run-check.sh
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import {
  threeWayMerge, detectConflicts, conflictSignature, resolutionStillValid
} from './.bundles/merge.mjs';
import { useDictionaryStore } from './.bundles/store.mjs';

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`); };

const baseEntry = (overrides = {}) => ({
  id: 'e1', headword: 'lo³³', pronunciation: 'lo˧', partOfSpeech: '方向词',
  definition: '向说话者移动', dialectVariants: [], examples: [], sources: [],
  synonyms: ['来'], status: 'confirmed', notes: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  reviewerComments: [], ...overrides
});

const snap = (revision, entries, extras = {}) => ({
  revision, entries, versions: [], audit: [], selectedId: entries[0]?.id ?? '', ...extras
});

const merge = (local, remote, base, resolutions = {}) => threeWayMerge({
  local, remote, base, resolutions, revision: Math.max(local.revision, remote.revision) + 1, now: '2026-09-30T00:00:00.000Z', actor: '编校页-test'
});

// 1. 甲补释义、乙改发音：不同字段自动并入
{
  const base = snap(1, [baseEntry()]);
  const local = snap(2, [baseEntry({ definition: '向说话者移动；引申为归来' })]);
  const remote = snap(2, [baseEntry({ pronunciation: 'lo˧˧（长低平）' })]);
  const result = merge(local, remote, base);
  assert.equal(result.ok, true);
  const merged = result.merged.entries[0];
  assert.equal(merged.definition, '向说话者移动；引申为归来');
  assert.equal(merged.pronunciation, 'lo˧˧（长低平）');
  assert.equal(result.merged.revision, 3);
  ok('不同字段（释义/发音）自动并入，修订号取双方最大值 +1');
}

// 2. 同一字段双方都基于旧值改过：先挂起、不产出合流快照；选择后写入
{
  const base = snap(1, [baseEntry()]);
  const local = snap(2, [baseEntry({ definition: '甲的释义' })]);
  const remote = snap(2, [baseEntry({ definition: '乙的释义' })]);
  const conflicts = detectConflicts(local, remote, base);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'field');
  assert.equal(conflicts[0].field, 'definition');
  let result = merge(local, remote, base, {});
  assert.equal(result.ok, false);
  assert.equal(result.merged, null);
  ok('同字段双方都改：检测到冲突且确认前不产出写回快照');

  const signature = conflictSignature(conflicts[0]);
  result = merge(local, remote, base, { 'e1#definition': { choice: 'remote', signature } });
  assert.equal(result.ok, true);
  assert.equal(result.merged.entries[0].definition, '乙的释义');
  result = merge(local, remote, base, { 'e1#definition': { choice: 'local', signature } });
  assert.equal(result.merged.entries[0].definition, '甲的释义');
  ok('并排选择本页/另一页后按选择合流');
}

// 3. 一边移出词条，另一边继续编辑：delete-edit 冲突，可保留可移除
{
  const base = snap(1, [baseEntry(), baseEntry({ id: 'e2', headword: 'tsha⁵⁵' })]);
  const edited = baseEntry({ id: 'e2', headword: 'tsha⁵⁵', definition: '乙继续修订的释义' });
  const local = snap(2, [baseEntry()]); // 本页删除 e2
  const remote = snap(2, [baseEntry(), edited]); // 另一页继续编辑
  const conflicts = detectConflicts(local, remote, base);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'delete-edit');
  assert.equal(conflicts[0].side, 'delete');
  const signature = conflictSignature(conflicts[0]);
  let result = merge(local, remote, base, { 'e2#delete-edit': { choice: 'keep', signature } });
  assert.equal(result.merged.entries.find((entry) => entry.id === 'e2').definition, '乙继续修订的释义');
  result = merge(local, remote, base, { 'e2#delete-edit': { choice: 'remove', signature } });
  assert.equal(result.merged.entries.find((entry) => entry.id === 'e2'), undefined);
  ok('移出/继续编辑冲突并排列出，确认前不写回；保留/移出均可');
}

// 4. 一方删除、另一方未动 → 删除自动并入；一方新增、另一方未涉及 → 新增自动并入
{
  const base = snap(1, [baseEntry(), baseEntry({ id: 'e2' })]);
  const local = snap(2, [baseEntry()]);
  const remote = snap(2, [baseEntry(), baseEntry({ id: 'e2' })]);
  let result = merge(local, remote, base);
  assert.equal(result.ok, true);
  assert.equal(result.merged.entries.length, 1);
  const fresh = baseEntry({ id: 'e9', headword: '新词' });
  result = merge(snap(2, [baseEntry(), baseEntry({ id: 'e2' }), fresh]), snap(1, [baseEntry(), baseEntry({ id: 'e2' })]), snap(1, [baseEntry(), baseEntry({ id: 'e2' })]));
  assert.equal(result.merged.entries.some((entry) => entry.id === 'e9'), true);
  ok('单边删除/单边新增自动并入');
}

// 5. 版本记录与审校意见一起保留（并集，不互相覆盖）
{
  const comment = { id: 'c9', field: 'definition', author: '主审·和老师', message: '请核对引申义', status: 'open', createdAt: '2026-09-01T00:00:00.000Z', replies: [] };
  const base = snap(1, [baseEntry()]);
  const local = snap(2, [baseEntry({ notes: '甲的备注' })], { versions: [{ id: 'v-local', at: '2026-09-02T00:00:00.000Z', action: '编辑字段', detail: '本页', before: [] }], audit: [{ id: 'a-local', at: '2026-09-02T00:00:00.000Z', action: '编辑字段', detail: '本页', entryIds: [] }] });
  const remote = snap(2, [baseEntry({ reviewerComments: [comment] })], { versions: [{ id: 'v-remote', at: '2026-09-03T00:00:00.000Z', action: '新增审校意见', detail: '另一页', before: [] }], audit: [{ id: 'a-remote', at: '2026-09-03T00:00:00.000Z', action: '新增审校意见', detail: '另一页', entryIds: [] }] });
  const result = merge(local, remote, base);
  assert.equal(result.ok, true);
  assert.ok(result.merged.versions.some((item) => item.id.startsWith('version-merge-3')));
  assert.ok(result.merged.audit.some((item) => item.id.startsWith('audit-merge-3')));
  assert.equal(result.merged.entries[0].notes, '甲的备注');
  assert.equal(result.merged.entries[0].reviewerComments[0].message, '请核对引申义');
  ok('版本记录、审计与审校意见随合流整包保留（并集）');
}

// 6. 对端在确认前再次保存：旧选择签名失配，必须重新列出
{
  const base = snap(1, [baseEntry()]);
  const local = snap(2, [baseEntry({ definition: '甲的释义' })]);
  const remote1 = snap(2, [baseEntry({ definition: '乙第一版释义' })]);
  const conflicts1 = detectConflicts(local, remote1, base);
  const staleSignature = conflictSignature(conflicts1[0]);
  const remote2 = snap(3, [baseEntry({ definition: '乙第二版释义', pronunciation: '乙还改了发音' })]);
  const conflicts2 = detectConflicts(local, remote2, base);
  assert.equal(resolutionStillValid(conflicts2[0], { choice: 'remote', signature: staleSignature }), false);
  const result = merge(local, remote2, base, { 'e1#definition': { choice: 'remote', signature: staleSignature } });
  assert.equal(result.ok, false);
  assert.equal(result.conflicts.some((c) => c.field === 'definition'), true);
  assert.equal(result.conflicts.some((c) => c.field === 'pronunciation'), false, '发音只有乙改，应自动并入');
  const auto = result.merged === null;
  assert.equal(auto, true);
  // 重新选择后：发音自动并入 + 释义按新选择
  const fresh = conflictSignature(conflicts2.find((c) => c.field === 'definition'));
  const resolved = merge(local, remote2, base, { 'e1#definition': { choice: 'remote', signature: fresh } });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.merged.entries[0].definition, '乙第二版释义');
  assert.equal(resolved.merged.entries[0].pronunciation, '乙还改了发音');
  ok('对端再推进时旧选择失效并重列，重试不会退回先保存者');
}

// 7. 双方把同一字段改成相同结果 → 直接收敛，不算冲突
{
  const base = snap(1, [baseEntry()]);
  const same = baseEntry({ notes: '双方一致的备注' });
  const result = merge(snap(2, [same]), snap(3, [same]), base);
  assert.equal(result.ok, true);
  assert.equal(result.merged.entries[0].notes, '双方一致的备注');
  ok('同字段改成相同值时自动收敛');
}

// ---------------- store 端到端（假 localStorage） ----------------
const storage = new Map();
let failNextWrites = 0;
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { if (failNextWrites > 0) { failNextWrites -= 1; throw new DOMException('配额不足', 'QuotaExceededError'); } storage.set(key, value); },
  removeItem: (key) => { storage.delete(key); },
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
  clear: () => storage.clear()
};

setActivePinia(createPinia());

// store 场景 1：首次水合写入初始快照；本页编辑保存
storage.clear();
setActivePinia(createPinia());
let store = useDictionaryStore();
store.hydrateFromBrowser();
assert.equal(JSON.parse(storage.get('sologsb-1021-dictionary-v1')).revision >= 1, true);
const firstRevision = store.revision;
store.updateField('entry-001', 'definition', '本页修改的释义');
store.syncToBrowser();
assert.equal(JSON.parse(storage.get('sologsb-1021-dictionary-v1')).entries[0].definition, '本页修改的释义');
assert.equal(store.syncError, '');
ok('store：编辑立即通过重读-合流-写回保存');

// store 场景 2：模拟另一页面从同一基版本保存了不同字段 → 本页再次保存时自动合流
{
  const mainKey = 'sologsb-1021-dictionary-v1';
  const stored = JSON.parse(storage.get(mainKey));
  const other = JSON.parse(JSON.stringify(stored));
  other.entries[0].pronunciation = '另一页改的发音';
  other.revision = stored.revision + 1;
  other.versions.unshift({ id: 'v-other', at: '2026-09-30T01:00:00.000Z', action: '编辑字段', detail: '发音', before: [] });
  storage.set(mainKey, JSON.stringify(other));

  store.updateField('entry-001', 'notes', '本页补的备注');
  store.syncToBrowser();
  const after = JSON.parse(storage.get(mainKey));
  assert.equal(after.entries[0].pronunciation, '另一页改的发音');
  assert.equal(after.entries[0].notes, '本页补的备注');
  assert.equal(after.entries[0].definition, '本页修改的释义');
  assert.equal(after.versions.some((v) => v.id === 'v-other'), true);
  assert.equal(after.versions.some((v) => v.id.startsWith(`version-merge-${after.revision}`)), true);
  assert.equal(store.pendingMerge, null);
  ok('store：保存前重读，非冲突改动自动合流，版本记录并集保存');
}

// store 场景 3：同字段冲突 → 挂起、主数据不被写回、选择随 sidecar 暂存；确认后写回
{
  const mainKey = 'sologsb-1021-dictionary-v1';
  const stored = JSON.parse(storage.get(mainKey));
  const other = JSON.parse(JSON.stringify(stored));
  other.entries[0].definition = '另一页抢先改的释义';
  other.revision = stored.revision + 1;
  const remoteRaw = JSON.stringify(other);
  storage.set(mainKey, remoteRaw);

  store.updateField('entry-001', 'definition', '本页想写的释义');
  store.syncToBrowser();
  assert.ok(store.pendingMerge, '应进入挂起合流');
  assert.equal(storage.get(mainKey), remoteRaw, '确认前主数据保持为先保存者的版本，不被任一侧覆盖');
  assert.equal(store.pendingConflicts.length, 1);
  assert.equal(store.pendingConflicts[0].field, 'definition');
  const conflict = store.pendingConflicts[0];
  store.chooseResolution(`${conflict.entryId}#definition`, 'local');
  assert.ok([...storage.keys()].some((key) => key.startsWith('sologsb-1021-pending-v1:')));
  store.resolvePendingMerge();
  const after = JSON.parse(storage.get(mainKey));
  assert.equal(after.entries[0].definition, '本页想写的释义');
  assert.equal(after.entries[0].pronunciation, '另一页改的发音');
  assert.equal(store.pendingMerge, null);
  ok('store：同字段冲突挂起不写回，选择暂存，确认后合流且保留先保存者的非冲突改动');
}

// store 场景 4：写入失败保留状态，重试成功且不回退对端
{
  const mainKey = 'sologsb-1021-dictionary-v1';
  const stored = JSON.parse(storage.get(mainKey));
  const other = JSON.parse(JSON.stringify(stored));
  other.entries[1].pronunciation = '对端在重试前又保存的发音';
  other.revision = stored.revision + 1;
  const remoteRaw = JSON.stringify(other);
  storage.set(mainKey, remoteRaw);

  failNextWrites = 1;
  store.updateField('entry-001', 'notes', '失败期间本页的备注');
  store.syncToBrowser();
  assert.match(store.syncError, /写入失败/);
  // 写入失败：存储保持为先保存者（对端）的状态，新备注未落盘
  assert.equal(storage.get(mainKey), remoteRaw);
  assert.equal(JSON.parse(storage.get(mainKey)).entries[1].pronunciation, '对端在重试前又保存的发音');
  // 本页内存状态保留
  assert.equal(store.entries[0].notes, '失败期间本页的备注');
  store.retrySync();
  assert.equal(store.syncError, '');
  const after = JSON.parse(storage.get(mainKey));
  assert.equal(after.entries[0].notes, '失败期间本页的备注');
  assert.equal(after.entries[1].pronunciation, '对端在重试前又保存的发音', '重试重新读取对端，不退回先保存者');
  ok('store：写入失败保留状态，重试重新合流且不回退先保存内容');
}

// store 场景 5：storage 事件（另一页写入）驱动即时合流
{
  const mainKey = 'sologsb-1021-dictionary-v1';
  const stored = JSON.parse(storage.get(mainKey));
  store.updateField('entry-002', 'notes', '本页正在写备注');
  store.syncToBrowser();
  const other = JSON.parse(JSON.stringify(JSON.parse(storage.get(mainKey))));
  other.entries[0].definition = '对端通过 storage 事件带来的释义';
  other.revision = other.revision + 1;
  storage.set(mainKey, JSON.stringify(other));
  store.handleExternalStorage(mainKey);
  assert.equal(store.entries[0].definition, '对端通过 storage 事件带来的释义');
  assert.equal(store.entries[1].notes, '本页正在写备注');
  const persisted = JSON.parse(storage.get(mainKey));
  assert.equal(persisted.entries[1].notes, '本页正在写备注');
  ok('store：收到另一页面 storage 事件后即时自动合流并写回');
}

console.log(`\n全部 ${passed} 项合流验证通过`);
