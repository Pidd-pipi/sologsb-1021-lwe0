import type { AuditRecord, DictionaryEntry, DictionarySnapshot, VersionRecord } from '~/types/dictionary';
import {
  conflictPath, FIELD_LABELS, MERGE_FIELDS,
  type ConflictResolution, type FieldConflict, type MergeConflict, type MergeInput, type MergeResult, type MergeSummaryEntry
} from '~/types/merge';

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

/** 结构相等（对象 key 顺序无关） */
export const deepEqual = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => { acc[key] = normalize((value as Record<string, unknown>)[key]); return acc; }, {});
  }
  return value;
}

const sig = (value: unknown) => JSON.stringify(normalize(value));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const entryMap = (snapshot: DictionarySnapshot) => new Map(snapshot.entries.map((entry) => [entry.id, entry]));

/** 冲突三方值指纹；对端在确认前再次保存时，不匹配的旧选择自动作废 */
export function conflictSignature(conflict: MergeConflict): string {
  if (conflict.kind === 'field') return `${sig(conflict.base)}|${sig(conflict.local)}|${sig(conflict.remote)}`;
  if (conflict.kind === 'delete-edit') return `${sig(conflict.base)}|${sig(conflict.edited)}`;
  return `${sig(conflict.local)}|${sig(conflict.remote)}`;
}

const VALID_CHOICES = new Set(['local', 'remote', 'keep', 'remove', 'rename-local', 'rename-remote']);

/** 选择是否仍与当前三方值匹配；任一侧变化或选择非法时旧选择作废，避免退回先保存者的内容 */
export function resolutionStillValid(conflict: MergeConflict, resolution: ConflictResolution | undefined): boolean {
  if (!resolution || !VALID_CHOICES.has(resolution.choice)) return false;
  if (conflict.kind === 'field' && resolution.choice !== 'local' && resolution.choice !== 'remote') return false;
  if (conflict.kind === 'delete-edit' && resolution.choice !== 'keep' && resolution.choice !== 'remove') return false;
  if (conflict.kind === 'create-create' && resolution.choice !== 'rename-local' && resolution.choice !== 'rename-remote') return false;
  return resolution.signature === conflictSignature(conflict);
}

interface DetectionResult {
  /** 检测到的全部冲突（不考虑是否已选择） */
  conflicts: MergeConflict[];
  /** 词条 id → 合流后的词条；含冲突的词条不会出现（除非冲突均已解决） */
  entries: DictionaryEntry[];
  /** 每个词条自动并入的字段（用于版本摘要） */
  summary: MergeSummaryEntry[];
}

function detectEntries(local: DictionarySnapshot, remote: DictionarySnapshot, base: DictionarySnapshot, resolutions: MergeInput['resolutions']) {
  const localMap = entryMap(local);
  const remoteMap = entryMap(remote);
  const baseMap = entryMap(base);
  const conflicts: MergeConflict[] = [];
  const out: DictionaryEntry[] = [];
  const summaryMap = new Map<string, MergeSummaryEntry>();

  const noteAuto = (entry: DictionaryEntry, field: (typeof MERGE_FIELDS)[number]) => {
    let item = summaryMap.get(entry.id);
    if (!item) { item = { entryId: entry.id, headword: entry.headword, fields: [], autoMerged: false }; summaryMap.set(entry.id, item); }
    item.fields.push(field);
  };

  new Set<string>([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]).forEach((id) => {
    const localEntry = localMap.get(id);
    const remoteEntry = remoteMap.get(id);
    const baseEntry = baseMap.get(id);

    if (!localEntry && !remoteEntry) return;

    if (localEntry && remoteEntry) {
      if (!baseEntry) {
        // 双方各自新建且撞了同一个 id（随机 id 理论上的极端情况）
        if (!deepEqual(localEntry, remoteEntry)) {
          const createConflict: MergeConflict = { kind: 'create-create', entryId: id, headword: localEntry.headword || remoteEntry.headword, local: localEntry, remote: remoteEntry };
          const resolution = resolutions[conflictPath(createConflict)];
          if (!resolutionStillValid(createConflict, resolution)) {
            conflicts.push(createConflict);
            return;
          }
          // 双方都保留，被选中改名的一方重新分配 id
          const localCopy = copy(localEntry);
          const remoteCopy = copy(remoteEntry);
          if (resolution.choice === 'rename-local') localCopy.id = uid('entry');
          else remoteCopy.id = uid('entry');
          out.push(localCopy, remoteCopy);
          return;
        }
        out.push(copy(localEntry));
        return;
      }
      if (deepEqual(localEntry, remoteEntry)) { out.push(copy(localEntry)); return; }

      const merged = copy(baseEntry);
      const entryConflicts: FieldConflict[] = [];
      MERGE_FIELDS.forEach((field) => {
        const b = baseEntry[field];
        const l = localEntry[field];
        const r = remoteEntry[field];
        const localChanged = !deepEqual(l, b);
        const remoteChanged = !deepEqual(r, b);
        if (!localChanged && !remoteChanged) return;
        if (localChanged && !remoteChanged) { merged[field] = copy(l) as never; noteAuto(localEntry, field); return; }
        if (remoteChanged && !localChanged) { merged[field] = copy(r) as never; noteAuto(remoteEntry, field); return; }
        // 两边都改：改成相同结果直接收敛，否则挂起等待并排确认
        if (deepEqual(l, r)) { merged[field] = copy(l) as never; noteAuto(localEntry, field); return; }
        entryConflicts.push({ kind: 'field', entryId: id, field, headword: localEntry.headword || remoteEntry.headword, base: b, local: l, remote: r });
      });

      const unresolved = entryConflicts.filter((conflict) => {
        const resolution = resolutions[conflictPath(conflict)];
        if (!resolutionStillValid(conflict, resolution)) return true;
        merged[conflict.field] = copy(resolution.choice === 'local' ? localEntry[conflict.field] : remoteEntry[conflict.field]) as never;
        return false;
      });
      conflicts.push(...unresolved);
      if (!unresolved.length) {
        merged.id = id;
        merged.createdAt = baseEntry.createdAt;
        merged.updatedAt = latest(baseEntry.updatedAt, localEntry.updatedAt, remoteEntry.updatedAt);
        out.push(merged);
        const item = summaryMap.get(id);
        if (item) { item.headword = merged.headword; item.autoMerged = true; }
      }
      return;
    }

    // 只剩一方
    const survivor = (localEntry ?? remoteEntry)!;
    const onLocal = Boolean(localEntry);
    if (!baseEntry) {
      // 一方新建、另一方未涉及 → 直接并入
      out.push(copy(survivor));
      if (!summaryMap.has(id)) summaryMap.set(id, { entryId: id, headword: survivor.headword, fields: [], autoMerged: false });
      return;
    }
    if (deepEqual(survivor, baseEntry)) return; // 一方删除、另一方未动 → 删除自动并入

    // 一边移出、另一边继续编辑 → 挂起，先并排列出
    const conflict: MergeConflict = {
      kind: 'delete-edit', entryId: id,
      side: onLocal ? 'editor' : 'delete',
      headword: survivor.headword,
      base: copy(baseEntry),
      edited: copy(survivor)
    };
    const resolution = resolutions[conflictPath(conflict)];
    if (!resolutionStillValid(conflict, resolution)) {
      conflicts.push(conflict);
      return;
    }
    if (resolution.choice === 'keep') {
      const kept = copy(survivor);
      kept.updatedAt = latest(kept.updatedAt);
      out.push(kept);
      const item = summaryMap.get(id) ?? { entryId: id, headword: kept.headword, fields: [], autoMerged: false };
      item.autoMerged = true;
      summaryMap.set(id, item);
    }
    // choice === 'remove'：确认删除，不放入结果
  });

  return { conflicts, entries: out, summary: [...summaryMap.values()] };
}

/** 仅检测冲突，不依赖选择结果，供并排对话框展示 */
export function detectConflicts(local: DictionarySnapshot, remote: DictionarySnapshot, base: DictionarySnapshot): MergeConflict[] {
  return detectEntries(local, remote, base, {}).conflicts;
}

/**
 * 三方合流：base 为共同祖先，local 为本标签页工作区，remote 为对端最新工作区。
 * 没碰同一字段的改动自动并入；同一字段双方都基于旧值改过、或删除/继续编辑同时发生时，
 * 作为冲突挂起，等待 resolutions 中逐条选择。版本记录与审校记录取并集。
 */
export function threeWayMerge(input: MergeInput): MergeResult {
  const { local, remote, base, resolutions, revision, now: at, actor } = input;
  const detected = detectEntries(local, remote, base, resolutions);
  if (detected.conflicts.length) {
    return { ok: false, merged: null, conflicts: detected.conflicts, summary: detected.summary };
  }

  // 保持原列表展示顺序：以本地顺序为主，追加远端独有的新词条
  const ordered: DictionaryEntry[] = [];
  const mergedMap = new Map(detected.entries.map((entry) => [entry.id, entry]));
  local.entries.forEach((entry) => { const hit = mergedMap.get(entry.id); if (hit) { ordered.push(hit); mergedMap.delete(entry.id); } });
  remote.entries.forEach((entry) => { const hit = mergedMap.get(entry.id); if (hit) { ordered.push(hit); mergedMap.delete(entry.id); } });
  mergedMap.forEach((entry) => ordered.push(entry));

  const versions = unionRecords<VersionRecord>(local.versions, remote.versions, (item) => item.id);
  const audit = unionRecords<AuditRecord>(local.audit, remote.audit, (item) => item.id);

  const autoEntries = detected.summary.filter((item) => item.fields.length);
  const fieldCount = autoEntries.reduce((sum, item) => sum + item.fields.length, 0);
  const remoteAdvanced = !deepEqual(remote, base);
  if (fieldCount > 0 || remoteAdvanced) {
    const detail = autoEntries.length
      ? `自动并入 ${autoEntries.length} 个词条的 ${fieldCount} 个字段改动（${autoEntries.slice(0, 3).map((item) => `${item.headword}·${item.fields.map((field) => FIELD_LABELS[field]).join('/')}`).join('；')}${autoEntries.length > 3 ? ' 等' : ''}）`
      : '汇合两端一致的修订';
    versions.unshift({
      id: `version-merge-${revision}-${uid('m').slice(-8)}`,
      at,
      action: '词条修订合流',
      detail: `${actor} 保存时与另一编校页面的修订合流，版本记录与审校意见已一并保留`,
      entryId: autoEntries[0]?.entryId,
      before: copy(base.entries)
    });
    audit.unshift({ id: `audit-merge-${revision}-${uid('m').slice(-8)}`, at, action: '词条修订合流', detail, entryIds: autoEntries.map((item) => item.entryId) });
  }

  const selectedId = local.selectedId && ordered.some((entry) => entry.id === local.selectedId)
    ? local.selectedId
    : (remote.selectedId && ordered.some((entry) => entry.id === remote.selectedId) ? remote.selectedId : ordered[0]?.id ?? '');

  const merged: DictionarySnapshot = { revision, entries: ordered, versions: versions.slice(0, 120), audit: audit.slice(0, 300), selectedId };
  return { ok: true, merged, conflicts: [], summary: detected.summary };
}

function latest(...candidates: Array<string | undefined>) {
  const values = candidates.filter(Boolean).sort();
  return values.at(-1) ?? new Date().toISOString();
}

function unionRecords<T>(localItems: T[], remoteItems: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  [...localItems, ...remoteItems].forEach((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

/** 字段值的紧凑展示，用于并排对照 */
export function previewValue(value: unknown, field?: string): string {
  if (value === undefined) return '（无）';
  if (Array.isArray(value)) {
    if (!value.length) return '（空）';
    if (field === 'synonyms') return (value as string[]).join('、');
    return value.map((item) => {
      if (typeof item === 'string') return item;
      const record = item as Record<string, unknown>;
      if (field === 'reviewerComments') return `${record.author ?? '审校'}：${record.message ?? JSON.stringify(item)}`;
      return [record.headword ?? record.text ?? record.title ?? record.form ?? record.dialect, record.definition ?? record.translation ?? record.pronunciation ?? record.citation ?? record.note]
        .filter(Boolean).join(' — ') || JSON.stringify(item);
    }).join('\n');
  }
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value) || '（空）';
}
