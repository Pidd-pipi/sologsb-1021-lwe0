import { mergeSnapshots, applyConflictResolutions, buildMergeAudit } from '../utils/merge';
import type { DictionarySnapshot } from '../types/dictionary';

/**
 * 这个脚本用真实的合流函数复刻 store.persist 的“读取-合流-比较并交换写回”循环，
 * 并注入写入失败与并发修改，验证：
 * 1) 重试不会把已保存的内容回退；
 * 2) 远端在读取后又变化时不会覆盖对方内容；
 * 3) 冲突未确认前不写回。
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

const baseEntry = () => ({
  id: 'e1', headword: 'ŋgɨ³³', pronunciation: 'ŋgɨ˧˧', partOfSpeech: '名词',
  definition: '小水潭', dialectVariants: [], examples: [], sources: [], synonyms: ['水潭'],
  status: 'draft' as const, notes: '', createdAt: now(), updatedAt: now(), reviewerComments: []
});

const snap = (entries: any[], revision: number): DictionarySnapshot => ({
  revision, entries, versions: [], audit: []
});

// ---- 假 localStorage，可注入失败 ----
class FakeStorage {
  store = new Map<string, string>();
  failNextWrite = false;
  failWriteCount = 0;
  writes = 0;
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.failWriteCount > 0) { this.failWriteCount -= 1; throw new Error('quota'); }
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('quota'); }
    this.writes += 1;
    this.store.set(k, v);
  }
  removeItem(k: string) { this.store.delete(k); }
}

const STORAGE_KEY = 'dict';

/** 复刻 store.persist 的核心循环 */
async function persist(
  storage: FakeStorage,
  getLocal: () => DictionarySnapshot,
  baseRef: { current: DictionarySnapshot | null },
  onConflict: (c: any[]) => void
): Promise<{ status: 'idle' | 'conflict' | 'retrying' }> {
  const local = getLocal();
  let remote = storage.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot : null;
  if (!baseRef.current) baseRef.current = remote ? clone(remote) : clone(local);
  const base = baseRef.current;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!remote || remote.revision <= base.revision) {
      const expected = remote ? remote.revision : null;
      try {
        const current = storage.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot : null;
        if (expected === null ? current !== null : current && current.revision !== expected) { remote = current; continue; }
        storage.setItem(STORAGE_KEY, JSON.stringify(local));
        baseRef.current = clone(local);
        return { status: 'idle' };
      } catch { remote = storage.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot : null; continue; }
    }
    const merged = mergeSnapshots(base, local, remote);
    if (merged.conflicts.length) { onConflict(merged.conflicts); return { status: 'conflict' }; }
    const out = clone(merged.snapshot);
    const audit = buildMergeAudit(merged.conflicts, {}, merged.autoCount, merged.changedEntryIds);
    out.audit = [audit, ...out.audit];
    try {
      const current = storage.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot : null;
      if (current && current.revision !== remote.revision) { remote = current; continue; }
      storage.setItem(STORAGE_KEY, JSON.stringify(out));
      baseRef.current = clone(out);
      return { status: 'idle' };
    } catch { remote = storage.getItem(STORAGE_KEY) ? JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot : null; continue; }
  }
  return { status: 'retrying' };
}

let passed = 0, failed = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
};

// 场景 A：写入失败后重试，已保存内容不回退
{
  const storage = new FakeStorage();
  const e = baseEntry();
  storage.setItem(STORAGE_KEY, JSON.stringify(snap([e], 1)));
  const baseRef = { current: snap([e], 1) };
  // 本端改释义
  const local = snap([{ ...e, definition: '甲方释义' }], 2);
  // 第一次写入连续失败 6 次，触发 retrying 路径
  storage.failWriteCount = 6;
  const r1 = await persist(storage, () => local, baseRef, () => {});
  check('A 首次返回 retrying', r1.status === 'retrying');
  check('A 失败后未写回（仍是基线 rev1）', JSON.parse(storage.getItem(STORAGE_KEY)!).revision === 1);
  // 模拟定时器触发的重试：此时远端未变，重试必须写回本端内容而非回退
  const r2 = await persist(storage, () => local, baseRef, () => {});
  check('A 重试返回 idle', r2.status === 'idle');
  const written = JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot;
  check('A 重试写回甲方释义（未回退）', written.entries[0]!.definition === '甲方释义');
  check('A 修订号为2', written.revision === 2);
}

// 场景 B：CAS 保护——读取后远端又被另一端修改，不能覆盖
{
  const storage = new FakeStorage();
  const e = baseEntry();
  storage.setItem(STORAGE_KEY, JSON.stringify(snap([e], 1)));
  const baseRef = { current: snap([e], 1) };
  const local = snap([{ ...e, definition: '甲方释义' }], 2);
  // 模拟：persist 读取远端后、写入前，另一端写入了新内容
  const origGet = storage.getItem.bind(storage);
  let intercepted = false;
  storage.getItem = (k: string) => {
    const v = origGet(k);
    if (!intercepted && k === STORAGE_KEY) {
      intercepted = true;
      // 另一端写入发音修改（基于 rev1）
      const other = snap([{ ...e, pronunciation: '对方发音' }], 2);
      storage.store.set(STORAGE_KEY, JSON.stringify(other));
    }
    return origGet(k);
  };
  const r = await persist(storage, () => local, baseRef, () => {});
  check('B 合流成功', r.status === 'idle');
  const written = JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot;
  check('B 甲方释义保留', written.entries[0]!.definition === '甲方释义');
  check('B 对方发音保留（未被回退）', written.entries[0]!.pronunciation === '对方发音');
  check('B 修订号跳升为3', written.revision === 3);
  check('B 含合流审计', written.audit.some((a) => a.action === '多端修订合流'));
}

// 场景 C：同字段冲突未确认前不写回
{
  const storage = new FakeStorage();
  const e = baseEntry();
  storage.setItem(STORAGE_KEY, JSON.stringify(snap([e], 1)));
  const baseRef = { current: snap([e], 1) };
  // 远端已被对方改成“乙方释义”
  storage.store.set(STORAGE_KEY, JSON.stringify(snap([{ ...e, definition: '乙方释义' }], 2)));
  const local = snap([{ ...e, definition: '甲方释义' }], 2);
  let conflicts: any[] = [];
  const r = await persist(storage, () => local, baseRef, (c) => { conflicts = c; });
  check('C 返回 conflict', r.status === 'conflict');
  check('C 列出1处冲突', conflicts.length === 1);
  check('C 未写回（远端仍是乙方释义）', JSON.parse(storage.getItem(STORAGE_KEY)!).entries[0].definition === '乙方释义');
  // 用户确认采用甲方
  const merged = mergeSnapshots(baseRef.current!, local, JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot);
  const applied = applyConflictResolutions(merged.snapshot, conflicts, { [conflicts[0].id]: 'ours' });
  storage.setItem(STORAGE_KEY, JSON.stringify(withAudit(applied, conflicts, { [conflicts[0].id]: 'ours' })));
  const written = JSON.parse(storage.getItem(STORAGE_KEY)!) as DictionarySnapshot;
  check('C 确认后写回甲方释义', written.entries[0]!.definition === '甲方释义');
}

function withAudit(s: DictionarySnapshot, conflicts: any[], choices: Record<string, any>): DictionarySnapshot {
  const out = clone(s);
  out.audit = [buildMergeAudit(conflicts, choices, 0, ['e1']), ...out.audit];
  return out;
}

console.log(`\n${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
