import type { AuditRecord, DictionaryEntry, DictionarySnapshot } from '~/types/dictionary';

/**
 * 多端修订合流：以“双方共同基线 + 本端状态 + 远端状态”做三路合并。
 * - 只在某一侧发生的字段改动自动并入；
 * - 同一字段两侧都基于旧值改过、或一侧删除而另一侧继续编辑时，产生冲突，
 *   先并排列出，交由用户逐处确认后才写回。
 * 合流只产生新对象，绝不改动调用方传入的快照。
 */

export type ConflictResolution = 'ours' | 'theirs';

export interface MergeConflict {
  /** 稳定标识：同一冲突点在多次重新合流之间保持不变，便于保留用户已选结果 */
  id: string;
  entryId: string;
  entryHeadword: string;
  kind: 'field' | 'item-field' | 'entry-delete' | 'item-delete';
  /** 删除方：ours = 本端删除，theirs = 远端删除 */
  deletedBy?: 'ours' | 'theirs';
  itemId?: string;
  itemKind?: 'dialectVariants' | 'examples' | 'sources' | 'reviewerComments';
  itemLabel?: string;
  field?: string;
  fieldLabel?: string;
  baseValue?: unknown;
  oursValue?: unknown;
  theirsValue?: unknown;
}

export interface MergeResult {
  snapshot: DictionarySnapshot;
  conflicts: MergeConflict[];
  /** 自动并入的字段改动处数 */
  autoCount: number;
  /** 发生改动（任一侧相对基线不同）的词条 id */
  changedEntryIds: string[];
}

const SCALAR_FIELDS = ['headword', 'pronunciation', 'partOfSpeech', 'definition', 'status', 'notes'] as const;
const ITEM_ARRAY_FIELDS = ['dialectVariants', 'examples', 'sources', 'reviewerComments'] as const;

const FIELD_LABELS: Record<string, string> = {
  headword: '词形',
  pronunciation: '发音',
  partOfSpeech: '词性',
  definition: '释义',
  status: '状态',
  notes: '编者备注',
  synonyms: '同义词',
  dialectVariants: '方言变体',
  examples: '例句',
  sources: '来源',
  reviewerComments: '审校意见'
};

const ITEM_SUBFIELDS: Record<string, readonly string[]> = {
  dialectVariants: ['dialect', 'form', 'pronunciation', 'note'],
  examples: ['text', 'translation', 'source'],
  sources: ['title', 'citation', 'url'],
  reviewerComments: ['field', 'author', 'message', 'status']
};

const SUBFIELD_LABELS: Record<string, string> = {
  dialect: '方言点',
  form: '词形',
  pronunciation: '读音',
  note: '说明',
  text: '原文',
  translation: '译文',
  source: '出处',
  title: '名称',
  citation: '引用信息',
  url: '链接',
  field: '绑定字段',
  author: '作者',
  message: '内容',
  status: '状态'
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const eq = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

const conflictId = (...parts: Array<string | undefined>) => ['cf', ...parts].join(':');

const itemLabel = (field: string, item: Record<string, unknown>): string => {
  if (field === 'dialectVariants') return `方言变体「${String(item.form || item.dialect || '未命名')}」`;
  if (field === 'examples') return `例句「${String(item.text || '').slice(0, 12)}」`;
  if (field === 'sources') return `来源「${String(item.title || '未命名')}」`;
  if (field === 'reviewerComments') return `审校意见「${String(item.message || '').slice(0, 12)}」`;
  return '子项';
};

const unionById = <T extends { id: string }>(ours: T[], theirs: T[]): T[] => {
  const map = new Map<string, T>();
  ours.forEach((item) => map.set(item.id, item));
  theirs.forEach((item) => { if (!map.has(item.id)) map.set(item.id, item); });
  return [...map.values()];
};

const pushFieldConflict = (
  conflicts: MergeConflict[],
  entry: DictionaryEntry,
  field: string,
  baseValue: unknown,
  oursValue: unknown,
  theirsValue: unknown
) => {
  conflicts.push({
    id: conflictId(entry.id, 'field', field),
    entryId: entry.id,
    entryHeadword: entry.headword || '未命名词条',
    kind: 'field',
    field,
    fieldLabel: FIELD_LABELS[field] ?? field,
    baseValue: clone(baseValue),
    oursValue: clone(oursValue),
    theirsValue: clone(theirsValue)
  });
};

const pushItemFieldConflict = (
  conflicts: MergeConflict[],
  entry: DictionaryEntry,
  itemKind: string,
  item: Record<string, unknown>,
  field: string,
  baseValue: unknown,
  oursValue: unknown,
  theirsValue: unknown
) => {
  conflicts.push({
    id: conflictId(entry.id, 'item', itemKind, String(item.id), 'field', field),
    entryId: entry.id,
    entryHeadword: entry.headword || '未命名词条',
    kind: 'item-field',
    itemId: String(item.id),
    itemKind: itemKind as MergeConflict['itemKind'],
    itemLabel: itemLabel(itemKind, item),
    field,
    fieldLabel: SUBFIELD_LABELS[field] ?? field,
    baseValue: clone(baseValue),
    oursValue: clone(oursValue),
    theirsValue: clone(theirsValue)
  });
};

/** 字符串数组字段（同义词）的三路合并：两侧都改且不一致时按冲突处理 */
const mergeStringArrayField = (
  field: string,
  base: DictionaryEntry,
  ours: DictionaryEntry,
  theirs: DictionaryEntry,
  result: DictionaryEntry,
  conflicts: MergeConflict[],
  markAuto: () => void
) => {
  const b = base[field as keyof DictionaryEntry] as string[];
  const o = ours[field as keyof DictionaryEntry] as string[];
  const t = theirs[field as keyof DictionaryEntry] as string[];
  if (eq(o, b) && eq(t, b)) return;
  if (eq(o, b)) { (result as DictionaryEntry)[field as 'synonyms'] = clone(t); markAuto(); return; }
  if (eq(t, b)) { (result as DictionaryEntry)[field as 'synonyms'] = clone(o); markAuto(); return; }
  if (eq(o, t)) { (result as DictionaryEntry)[field as 'synonyms'] = clone(o); return; }
  pushFieldConflict(conflicts, base, field, b, o, t);
  (result as DictionaryEntry)[field as 'synonyms'] = clone(o);
};

/** 审校意见的回复按 id 并集（回复只追加，不会同字段冲突） */
const mergeReplies = (baseReplies: Array<{ id: string }>, oursReplies: Array<{ id: string }>, theirsReplies: Array<{ id: string }>) => {
  const seen = new Set<string>();
  const out: Array<{ id: string }> = [];
  [...baseReplies, ...oursReplies, ...theirsReplies].forEach((reply) => {
    if (seen.has(reply.id)) return;
    seen.add(reply.id);
    out.push(clone(reply));
  });
  return out;
};

/** 单子项内部标量字段的三路合并 */
const mergeItemFields = (
  itemKind: string,
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  entry: DictionaryEntry,
  conflicts: MergeConflict[],
  markAuto: () => void
): Record<string, unknown> => {
  const result = clone(base);
  ITEM_SUBFIELDS[itemKind]!.forEach((subField) => {
    const b = base[subField];
    const o = ours[subField];
    const t = theirs[subField];
    if (eq(o, b) && eq(t, b)) return;
    if (eq(o, b)) { result[subField] = clone(t); markAuto(); return; }
    if (eq(t, b)) { result[subField] = clone(o); markAuto(); return; }
    if (eq(o, t)) { result[subField] = clone(o); return; }
    pushItemFieldConflict(conflicts, entry, itemKind, base, subField, b, o, t);
    result[subField] = clone(o);
  });
  if (itemKind === 'reviewerComments') {
    result.replies = mergeReplies(
      (base.replies as Array<{ id: string }>) ?? [],
      (ours.replies as Array<{ id: string }>) ?? [],
      (theirs.replies as Array<{ id: string }>) ?? []
    );
  }
  return result;
};

/** 对象数组字段按子项 id 三路合并；一侧删除、另一侧修改同一子项时产生冲突 */
const mergeItems = (
  itemKind: string,
  baseItems: Array<Record<string, unknown>>,
  oursItems: Array<Record<string, unknown>>,
  theirsItems: Array<Record<string, unknown>>,
  entry: DictionaryEntry,
  conflicts: MergeConflict[],
  markAuto: () => void
): Array<Record<string, unknown>> => {
  const baseMap = new Map(baseItems.map((item) => [item.id, item]));
  const oursMap = new Map(oursItems.map((item) => [item.id, item]));
  const theirsMap = new Map(theirsItems.map((item) => [item.id, item]));
  const out: Array<Record<string, unknown>> = [];

  baseItems.forEach((baseItem) => {
    const oursItem = oursMap.get(baseItem.id);
    const theirsItem = theirsMap.get(baseItem.id);
    if (oursItem && theirsItem) {
      out.push(mergeItemFields(itemKind, baseItem, oursItem, theirsItem, entry, conflicts, markAuto));
    } else if (oursItem && !theirsItem) {
      // 远端删除，本端未改动则接受删除；本端继续修改则冲突
      if (eq(oursItem, baseItem)) return;
      conflicts.push({
        id: conflictId(entry.id, 'item-delete', itemKind, String(baseItem.id), 'theirs'),
        entryId: entry.id,
        entryHeadword: entry.headword || '未命名词条',
        kind: 'item-delete',
        deletedBy: 'theirs',
        itemId: String(baseItem.id),
        itemKind: itemKind as MergeConflict['itemKind'],
        itemLabel: itemLabel(itemKind, baseItem),
        baseValue: clone(baseItem),
        oursValue: clone(oursItem),
        theirsValue: null
      });
      out.push(clone(oursItem));
    } else if (!oursItem && theirsItem) {
      if (eq(theirsItem, baseItem)) return;
      conflicts.push({
        id: conflictId(entry.id, 'item-delete', itemKind, String(baseItem.id), 'ours'),
        entryId: entry.id,
        entryHeadword: entry.headword || '未命名词条',
        kind: 'item-delete',
        deletedBy: 'ours',
        itemId: String(baseItem.id),
        itemKind: itemKind as MergeConflict['itemKind'],
        itemLabel: itemLabel(itemKind, baseItem),
        baseValue: clone(baseItem),
        oursValue: null,
        theirsValue: clone(theirsItem)
      });
      out.push(clone(theirsItem));
    }
  });

  oursItems.forEach((item) => {
    if (baseMap.has(item.id)) return;
    // 两侧各自新增的子项 id 理论上不会撞号；撞号时保留本端
    out.push(clone(item));
  });
  theirsItems.forEach((item) => {
    if (baseMap.has(item.id) || oursMap.has(item.id)) return;
    out.push(clone(item));
  });

  return out;
};

const mergeEntry = (
  base: DictionaryEntry | undefined,
  ours: DictionaryEntry | undefined,
  theirs: DictionaryEntry | undefined,
  conflicts: MergeConflict[],
  markAuto: () => void
): DictionaryEntry | null => {
  if (!base) {
    if (ours && !theirs) return clone(ours);
    if (!ours && theirs) return clone(theirs);
    if (ours && theirs) return clone(ours);
    return null;
  }
  if (!ours && !theirs) return null;
  if (!ours) {
    // 本端删除：远端未改动则删除成立，否则“一边移出、一边继续编辑”冲突
    if (eq(theirs, base)) return null;
    conflicts.push({
      id: conflictId(base.id, 'entry-delete', 'ours'),
      entryId: base.id,
      entryHeadword: base.headword || '未命名词条',
      kind: 'entry-delete',
      deletedBy: 'ours',
      baseValue: '（基线中存在）',
      oursValue: null,
      theirsValue: clone(theirs)
    });
    return clone(theirs);
  }
  if (!theirs) {
    if (eq(ours, base)) return null;
    conflicts.push({
      id: conflictId(base.id, 'entry-delete', 'theirs'),
      entryId: base.id,
      entryHeadword: base.headword || '未命名词条',
      kind: 'entry-delete',
      deletedBy: 'theirs',
      baseValue: '（基线中存在）',
      oursValue: clone(ours),
      theirsValue: null
    });
    return clone(ours);
  }

  const result = clone(base);
  SCALAR_FIELDS.forEach((field) => {
    const b = base[field];
    const o = ours[field];
    const t = theirs[field];
    if (eq(o, b) && eq(t, b)) return;
    if (eq(o, b)) { (result as DictionaryEntry)[field] = clone(t); markAuto(); return; }
    if (eq(t, b)) { (result as DictionaryEntry)[field] = clone(o); markAuto(); return; }
    if (eq(o, t)) { (result as DictionaryEntry)[field] = clone(o); return; }
    pushFieldConflict(conflicts, base, field, b, o, t);
    (result as DictionaryEntry)[field] = clone(o);
  });

  mergeStringArrayField('synonyms', base, ours, theirs, result, conflicts, markAuto);

  ITEM_ARRAY_FIELDS.forEach((itemKind) => {
    (result as DictionaryEntry)[itemKind] = mergeItems(
      itemKind,
      base[itemKind] as unknown as Array<Record<string, unknown>>,
      ours[itemKind] as unknown as Array<Record<string, unknown>>,
      theirs[itemKind] as unknown as Array<Record<string, unknown>>,
      base,
      conflicts,
      markAuto
    );
  });

  result.updatedAt = ours.updatedAt > theirs.updatedAt ? ours.updatedAt : theirs.updatedAt;
  return result;
};

/**
 * 三路合流入口。base 为双方共同基线，ours 为本端工作副本，theirs 为远端最新快照。
 */
export function mergeSnapshots(
  base: DictionarySnapshot,
  ours: DictionarySnapshot,
  theirs: DictionarySnapshot
): MergeResult {
  const conflicts: MergeConflict[] = [];
  let autoCount = 0;
  const markAuto = () => { autoCount += 1; };

  const entryIds = new Set<string>();
  [...base.entries, ...ours.entries, ...theirs.entries].forEach((entry) => entryIds.add(entry.id));

  const entries: DictionaryEntry[] = [];
  entryIds.forEach((id) => {
    const merged = mergeEntry(
      base.entries.find((entry) => entry.id === id),
      ours.entries.find((entry) => entry.id === id),
      theirs.entries.find((entry) => entry.id === id),
      conflicts,
      markAuto
    );
    if (merged) entries.push(merged);
  });

  const changedEntryIds = [...entryIds].filter((id) => {
    const b = base.entries.find((entry) => entry.id === id);
    const o = ours.entries.find((entry) => entry.id === id);
    const t = theirs.entries.find((entry) => entry.id === id);
    return !eq(b, o) || !eq(b, t);
  });

  const versions = unionById(ours.versions, theirs.versions)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 120);
  const audit = unionById(ours.audit, theirs.audit)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 300);
  const revision = Math.max(ours.revision, theirs.revision) + 1;

  return {
    snapshot: { revision, entries, versions, audit },
    conflicts,
    autoCount,
    changedEntryIds
  };
}

/** 按用户逐处选择应用冲突结果；未选择的冲突默认保留本端值 */
export function applyConflictResolutions(
  snapshot: DictionarySnapshot,
  conflicts: MergeConflict[],
  choices: Record<string, ConflictResolution>
): DictionarySnapshot {
  const out = clone(snapshot);
  conflicts.forEach((conflict) => {
    const choice = choices[conflict.id] ?? 'ours';
    if (conflict.kind === 'entry-delete') {
      // 选择与删除方一致 → 接受删除；否则保留合流快照中暂存的修改方版本
      if (choice === conflict.deletedBy) {
        const index = out.entries.findIndex((entry) => entry.id === conflict.entryId);
        if (index >= 0) out.entries.splice(index, 1);
      }
      return;
    }
    const entry = out.entries.find((item) => item.id === conflict.entryId);
    if (!entry) return;
    if (conflict.kind === 'item-delete') {
      const items = entry[conflict.itemKind!] as unknown as Array<Record<string, unknown>>;
      if (choice === conflict.deletedBy) {
        const index = items.findIndex((item) => item.id === conflict.itemId);
        if (index >= 0) items.splice(index, 1);
      }
      return;
    }
    if (conflict.kind === 'field') {
      (entry as Record<string, unknown>)[conflict.field!] = choice === 'ours' ? clone(conflict.oursValue) : clone(conflict.theirsValue);
    } else if (conflict.kind === 'item-field') {
      const items = entry[conflict.itemKind!] as unknown as Array<Record<string, unknown>>;
      const item = items.find((candidate) => candidate.id === conflict.itemId);
      if (item) {
        item[conflict.field!] = choice === 'ours' ? clone(conflict.oursValue) : clone(conflict.theirsValue);
      }
    }
  });
  return out;
}

/** 把合流结果（含用户已选结果）记入审计，与词条、版本记录一并写回 */
export function buildMergeAudit(
  conflicts: MergeConflict[],
  choices: Record<string, ConflictResolution>,
  autoCount: number,
  entryIds: string[]
): AuditRecord {
  const oursCount = conflicts.filter((conflict) => (choices[conflict.id] ?? 'ours') === 'ours').length;
  const theirsCount = conflicts.length - oursCount;
  const parts: string[] = [];
  if (autoCount) parts.push(`自动并入 ${autoCount} 处双方未触碰同一字段的改动`);
  if (conflicts.length) parts.push(`${conflicts.length} 处同字段冲突已逐处确认（采用我方 ${oursCount} · 采用对方 ${theirsCount}）`);
  else parts.push('双方改动互不冲突，已自动合流');
  return {
    id: uid('audit'),
    at: now(),
    action: '多端修订合流',
    detail: parts.join('；'),
    entryIds
  };
}
