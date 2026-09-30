import type { DictionaryEntry, EntryStatus } from './dictionary';

/** 参与逐字段三方合流的词条字段（id/createdAt/updatedAt 不参与人工编辑） */
export const MERGE_FIELDS = [
  'headword', 'pronunciation', 'partOfSpeech', 'definition',
  'dialectVariants', 'examples', 'sources', 'synonyms',
  'status', 'notes', 'reviewerComments'
] as const satisfies ReadonlyArray<keyof DictionaryEntry>;

export type MergeField = (typeof MERGE_FIELDS)[number];

export const FIELD_LABELS: Record<MergeField, string> = {
  headword: '词形',
  pronunciation: '发音说明',
  partOfSpeech: '词性',
  definition: '释义',
  dialectVariants: '方言变体',
  examples: '例句',
  sources: '来源',
  synonyms: '同义词',
  status: '词条状态',
  notes: '编者备注',
  reviewerComments: '审校意见'
};

export const STATUS_LABELS: Record<EntryStatus, string> = {
  draft: '草稿', review: '待审', disputed: '争议', confirmed: '已确认'
};

/** 字段级冲突：双方都基于旧值改了同一字段 */
export interface FieldConflict {
  kind: 'field';
  entryId: string;
  field: MergeField;
  headword: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

/** 删除/编辑冲突：一边移出词条，另一边继续编辑 */
export interface DeleteEditConflict {
  kind: 'delete-edit';
  entryId: string;
  /** editor：远端已删除、本地仍在编辑；delete：本地已删除、远端仍在编辑 */
  side: 'editor' | 'delete';
  headword: string;
  base: DictionaryEntry;
  /** 仍在编辑一侧的最新词条（另一侧视为 undefined） */
  edited: DictionaryEntry;
}

/** 双方各自新建时撞上了同一个词条 id（概率极低，仍须显式处理） */
export interface CreateCreateConflict {
  kind: 'create-create';
  entryId: string;
  headword: string;
  local: DictionaryEntry;
  remote: DictionaryEntry;
}

export type MergeConflict = FieldConflict | DeleteEditConflict | CreateCreateConflict;

/** 冲突路径：entryId#field 或 entryId#delete-edit 等，作为合流选择的稳定键 */
export type ConflictPath = string;

/**
 * 每处冲突的人工选择：
 * - local / remote：采用对应一侧的整个值
 * - keep / remove：删除/编辑冲突中保留词条或确认移除
 * - rename-local / rename-remote：新建撞号时保留对应词条并重新分配 id
 *
 * signature 为做出选择时 base/local/remote 三方值的指纹；对端在确认前再次保存时，
 * 任一方值变化都会使签名失配，旧选择作废并重新并排列出。
 */
export type ConflictResolution =
  | { choice: 'local' | 'remote' | 'keep' | 'remove' | 'rename-local' | 'rename-remote'; signature: string };

export type ResolutionMap = Record<ConflictPath, ConflictResolution>;

export interface MergeSummaryEntry {
  entryId: string;
  headword: string;
  fields: MergeField[];
  autoMerged: boolean;
}

export interface MergeInput {
  /** 本标签页当前工作区 */
  local: import('./dictionary').DictionarySnapshot;
  /** 对端（localStorage 中）的最新工作区 */
  remote: import('./dictionary').DictionarySnapshot;
  /** 本标签页上次同步时所基于的工作区 */
  base: import('./dictionary').DictionarySnapshot;
  /** 对字段/删除冲突已经做出的选择（create-create 不使用） */
  resolutions: ResolutionMap;
  /** 合流提交时使用的修订号与时间戳 */
  revision: number;
  now: string;
  /** 写入版本记录/审计的动作者标签（标签页标识） */
  actor: string;
}

export interface MergeResult {
  ok: boolean;
  merged: import('./dictionary').DictionarySnapshot | null;
  conflicts: MergeConflict[];
  summary: MergeSummaryEntry[];
}

/** 挂起中的合流：刷新后仍可继续做选择，确认前不写回主数据 */
export interface PendingMerge {
  id: string;
  actor: string;
  createdAt: string;
  local: import('./dictionary').DictionarySnapshot;
  remote: import('./dictionary').DictionarySnapshot;
  base: import('./dictionary').DictionarySnapshot;
  resolutions: ResolutionMap;
}

export const conflictPath = (conflict: Pick<MergeConflict, 'kind' | 'entryId'> & { field?: MergeField }): ConflictPath =>
  'field' in conflict ? `${conflict.entryId}#${conflict.field}` : `${conflict.entryId}#${conflict.kind}`;
