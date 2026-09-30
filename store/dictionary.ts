import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  AuditRecord, DictionaryEntry, DictionarySnapshot, DuplicatePair, EntryStatus, ReviewComment, VersionRecord
} from '~/types/dictionary';
import type { PendingMerge, ResolutionMap } from '~/types/merge';
import { conflictPath } from '~/types/merge';
import { conflictSignature, deepEqual, detectConflicts, resolutionStillValid, threeWayMerge } from '~/utils/merge';
import { findDuplicates } from '~/utils/dictionary';

const STORAGE_KEY = 'sologsb-1021-dictionary-v1';
const PENDING_PREFIX = 'sologsb-1021-pending-v1:';

const now = () => new Date().toISOString();
const localUid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isClient = () => import.meta.client;

const seedEntries = (): DictionaryEntry[] => [
  {
    id: 'entry-001', headword: 'ŋgɨ³³', pronunciation: 'ŋgɨ˧˧（低平调）', partOfSpeech: '名词', definition: '山间常年不涸的小水潭；也用来比喻安静而可靠的人。',
    dialectVariants: [
      { id: 'v-1', dialect: '北坡话', form: 'ŋgɨ³³ tsha⁵⁵', pronunciation: 'ŋgɨ tsha', note: '强调泉水源头' },
      { id: 'v-2', dialect: '河谷话', form: 'a³³ ŋgɨ³³', pronunciation: 'a ŋgɨ', note: '前缀形式' }
    ],
    examples: [
      { id: 'ex-1', text: 'a³³ ŋgɨ³³ ma³³ ʔmɨ⁵⁵.', translation: '这个小水潭是甜的。', source: '民间故事·寻找水源' },
      { id: 'ex-2', text: 'ŋgɨ³³ tɕi⁵⁵ dza³³.', translation: '山泉到了冬天也不会干。', source: '访谈录音 2018-04' }
    ],
    sources: [
      { id: 'src-1', title: '北坡方言词汇表', citation: '李某某记录，1987，手稿第 42 页', url: '' },
      { id: 'src-2', title: '嘎木村发音人访谈', citation: '录音 A-2018-04-17，00:12:31', url: '' }
    ],
    synonyms: ['水潭', '泉水'], status: 'confirmed', notes: '声调标音经两位发音人复核。', createdAt: '2024-08-11T04:00:00.000Z', updatedAt: '2025-03-09T06:12:00.000Z', reviewerComments: []
  },
  {
    id: 'entry-002', headword: 'dʑa⁵⁵', pronunciation: 'dʑa˥（高平调）', partOfSpeech: '动词', definition: '把谷物摊开晾晒；引申为耐心等待事情成熟。',
    dialectVariants: [{ id: 'v-3', dialect: '东南村话', form: 'dʑa⁵⁵ ka³³', pronunciation: 'dʑa ka', note: '带结果补语 habitual 形式' }],
    examples: [{ id: 'ex-3', text: 'kho⁵⁵ dʑa⁵⁵ tɕhi³³.', translation: '谷子已经摊开晒了。', source: '田野记录 2023-09-12' }],
    sources: [{ id: 'src-3', title: '东南村生产词调查', citation: '王某某，2023，词条 071', url: '' }],
    synonyms: ['晒', '等待'], status: 'review', notes: '“等待”的引申义需由审校人确认。', createdAt: '2024-10-01T06:00:00.000Z', updatedAt: '2025-02-18T02:00:00.000Z',
    reviewerComments: [{ id: 'c-1', field: 'definition', author: '主审·和老师', message: '“等待”是短语层面的临时义还是固定引申义？请补充一条例句。', status: 'open', createdAt: '2025-02-18T02:00:00.000Z', replies: [] }]
  },
  {
    id: 'entry-003', headword: 'dʑa³³', pronunciation: 'dʑa˧（中调）', partOfSpeech: '动词', definition: '摊晒谷物，使水分蒸发。', dialectVariants: [], examples: [{ id: 'ex-4', text: 'dʑa³³ ko⁵⁵ kho⁵⁵.', translation: '把粮食拿去晒。', source: '语音调查 M-12' }], sources: [{ id: 'src-4', title: '方言调查卡片', citation: '1992，卡片 M-12', url: '' }], synonyms: ['晒粮'], status: 'disputed', notes: '与 dʑa⁵⁵ 可能是同一词条的声调变体。', createdAt: '2024-12-01T06:00:00.000Z', updatedAt: '2025-02-20T03:00:00.000Z', reviewerComments: []
  },
  {
    id: 'entry-004', headword: 'ʔma³³', pronunciation: 'ʔma˧', partOfSpeech: '名词', definition: '母亲；也可用于称呼年长女性亲属。', dialectVariants: [{ id: 'v-4', dialect: '河西话', form: 'ma³³', pronunciation: 'ma', note: '喉塞音弱化' }], examples: [{ id: 'ex-5', text: 'ʔma³³, ŋa⁵⁵ tɕi³³ lo³³.', translation: '妈妈，我要回家了。', source: '日常生活会话 01' }], sources: [{ id: 'src-5', title: '亲缘称谓调查', citation: '赵某某，2011，表 3', url: '' }], synonyms: ['妈妈', '母亲'], status: 'draft', notes: '需补充敬称形式。', createdAt: '2025-01-11T04:00:00.000Z', updatedAt: '2025-01-11T04:00:00.000Z', reviewerComments: []
  },
  {
    id: 'entry-005', headword: 'lo³³', pronunciation: 'lo˧', partOfSpeech: '方向词', definition: '表示向说话者所在位置移动，常与位移动词搭配。', dialectVariants: [], examples: [{ id: 'ex-6', text: 'a³³ mɨ⁵⁵ lo³³.', translation: '到这里来。', source: '语法调查句表 03' }], sources: [{ id: 'src-6', title: '动词方向范畴笔记', citation: '陈某某，2005，第 18 页', url: '' }], synonyms: ['来'], status: 'confirmed', notes: '', createdAt: '2024-09-18T02:00:00.000Z', updatedAt: '2025-01-04T02:00:00.000Z', reviewerComments: []
  },
  {
    id: 'entry-006', headword: 'tsha⁵⁵', pronunciation: 'tsha˥', partOfSpeech: '名词', definition: '水源；泉水涌出的地方。', dialectVariants: [], examples: [{ id: 'ex-7', text: 'tsha⁵⁵ ʔmɨ⁵⁵ ma³³.', translation: '泉眼在这个地方。', source: '地名调查 2022-07' }], sources: [{ id: 'src-7', title: '村落地名调查', citation: '录音 C-2022-07，00:22:08', url: '' }], synonyms: ['泉眼', '水潭'], status: 'review', notes: '', createdAt: '2025-02-01T02:00:00.000Z', updatedAt: '2025-02-25T02:00:00.000Z',
    reviewerComments: [{ id: 'c-2', field: 'sources', author: '审校·罗老师', message: '请把录音中发言人姓名补到资料来源。', status: 'open', createdAt: '2025-02-25T02:00:00.000Z', replies: [{ id: 'r-1', author: '编辑·阿木', message: '已向调查员索取授权信息，暂以录音编号占位。', createdAt: '2025-02-26T01:00:00.000Z' }] }]
  }
];

const seedAudit: AuditRecord[] = [{
  id: 'audit-seed', at: now(), action: '载入工作区', detail: '初始化 6 个词条、2 条待回复审校意见和 1 组疑似重复词条', entryIds: []
}];

export const useDictionaryStore = defineStore('dictionary', () => {
  const revision = ref(1);
  const entries = reactive<DictionaryEntry[]>(seedEntries());
  const versions = reactive<VersionRecord[]>([]);
  const audit = reactive<AuditRecord[]>(seedAudit);
  const selectedId = ref(entries[0]?.id ?? '');
  const hydrated = ref(false);
  const undoStack = ref<DictionarySnapshot[]>([]);
  const redoStack = ref<DictionarySnapshot[]>([]);
  const query = ref('');
  const statusFilter = ref<EntryStatus | 'all'>('all');
  const dialectFilter = ref('all');
  const fieldReplyDrafts = reactive<Record<string, string>>({});

  // 多页面合流状态
  const actor = ref(`编校页-${localUid('page').slice(-4)}`);
  const baseSnapshot = ref<DictionarySnapshot | null>(null);
  const pendingMerge = ref<PendingMerge | null>(null);
  const syncError = ref('');
  const syncNotice = ref('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedEntry = computed(() => entries.find((entry) => entry.id === selectedId.value) ?? entries[0]);
  const persistableSnapshot = computed<DictionarySnapshot>(() => ({
    revision: revision.value,
    entries: clone(entries),
    versions: clone(versions),
    audit: clone(audit),
    selectedId: selectedId.value
  }));
  const duplicates = computed<DuplicatePair[]>(() => findDuplicates(entries));
  const openComments = computed(() => entries.reduce((sum, entry) => sum + entry.reviewerComments.filter((comment) => comment.status === 'open').length, 0));
  const filteredEntries = computed(() => {
    const term = query.value.trim().toLowerCase();
    return entries.filter((entry) => {
      if (statusFilter.value !== 'all' && entry.status !== statusFilter.value) return false;
      if (dialectFilter.value !== 'all' && !entry.dialectVariants.some((variant) => variant.dialect === dialectFilter.value)) return false;
      if (!term) return true;
      const haystack = [entry.headword, entry.definition, entry.partOfSpeech, entry.pronunciation, ...entry.synonyms, ...entry.sources.map((source) => source.title)].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });
  const dialects = computed(() => [...new Set(entries.flatMap((entry) => entry.dialectVariants.map((variant) => variant.dialect)))].sort());
  const pendingConflicts = computed(() => {
    const pending = pendingMerge.value;
    if (!pending) return [];
    return detectConflicts(pending.local, pending.remote, pending.base);
  });
  /** 已做出且对当前三方值仍有效的选择数 */
  const pendingResolvedCount = computed(() => {
    const pending = pendingMerge.value;
    if (!pending) return 0;
    return pendingConflicts.value.reduce((sum, conflict) => {
      const resolution = pending.resolutions[conflictPath(conflict)];
      return sum + (resolution && resolutionStillValid(conflict, resolution) ? 1 : 0);
    }, 0);
  });

  function flashNotice(message: string) {
    syncNotice.value = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { syncNotice.value = ''; }, 6000);
  }

  /** 用给定快照替换工作区（不产生版本记录、不动基快照） */
  function adopt(value: DictionarySnapshot) {
    revision.value = value.revision ?? 1;
    entries.splice(0, entries.length, ...(clone(value.entries ?? [])));
    versions.splice(0, versions.length, ...(clone(value.versions ?? [])));
    audit.splice(0, audit.length, ...(clone(value.audit ?? [])));
    if (value.selectedId && entries.some((entry) => entry.id === value.selectedId)) selectedId.value = value.selectedId;
    else if (!entries.some((entry) => entry.id === selectedId.value)) selectedId.value = entries[0]?.id ?? '';
  }

  function snapshot(): DictionarySnapshot {
    return {
      revision: revision.value,
      entries: clone(entries),
      versions: clone(versions),
      audit: clone(audit),
      selectedId: selectedId.value
    };
  }

  function restore(value: DictionarySnapshot) {
    revision.value = value.revision ?? 1;
    entries.splice(0, entries.length, ...(clone(value.entries ?? [])));
    versions.splice(0, versions.length, ...(clone(value.versions ?? [])));
    audit.splice(0, audit.length, ...(clone(value.audit ?? [])));
    if (value.selectedId && entries.some((entry) => entry.id === value.selectedId)) selectedId.value = value.selectedId;
    else if (!entries.some((entry) => entry.id === selectedId.value)) selectedId.value = entries[0]?.id ?? '';
  }

  function commit(action: string, detail: string, entryIds: string[], mutation: () => void) {
    undoStack.value = [...undoStack.value.slice(-49), snapshot()];
    redoStack.value = [];
    const before = clone(entries);
    mutation();
    revision.value += 1;
    entries.forEach((entry) => { if (entryIds.includes(entry.id)) entry.updatedAt = now(); });
    versions.unshift({ id: localUid('version'), at: now(), action, detail, entryId: entryIds[0], before });
    versions.splice(120);
    audit.unshift({ id: localUid('audit'), at: now(), action, detail, entryIds });
    audit.splice(300);
  }

  // ---------- 多页面修订合流 ----------

  function readRemote(): DictionarySnapshot | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DictionarySnapshot;
  }

  /** 先序列化再写入；任何失败都不改动 localStorage，调用方据此保留状态重试 */
  function writeSnapshot(value: DictionarySnapshot): boolean {
    const serialized = JSON.stringify(value);
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  }

  function persistSidecar(pending: PendingMerge | null) {
    // 每个编校页一个挂起槽（按 actor），不清除其它页面的暂存
    const key = `${PENDING_PREFIX}${actor.value}`;
    if (!pending) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, JSON.stringify(pending));
  }

  function readSidecar(): PendingMerge | null {
    let latestPending: PendingMerge | null = null;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PENDING_PREFIX)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null') as PendingMerge | null;
        if (value && (!latestPending || value.createdAt > latestPending.createdAt)) latestPending = value;
      } catch {
        localStorage.removeItem(key);
      }
    }
    return latestPending;
  }

  function makePending(local: DictionarySnapshot, remote: DictionarySnapshot, base: DictionarySnapshot, resolutions: ResolutionMap): PendingMerge {
    return { id: localUid('pending'), actor: actor.value, createdAt: now(), local: clone(local), remote: clone(remote), base: clone(base), resolutions: clone(resolutions) };
  }

  /**
   * 与对端最新修订合流：
   * - 无冲突：直接返回合流快照；
   * - 有冲突：登记挂起（含此前的选择），由并排对话框确认。
   */
  function integrateRemote(remote: DictionarySnapshot, localSnapshot: DictionarySnapshot): DictionarySnapshot | null {
    const base = baseSnapshot.value!;
    const nextRevision = Math.max(localSnapshot.revision, remote.revision) + 1;
    const result = threeWayMerge({
      local: localSnapshot, remote, base,
      resolutions: pendingMerge.value?.resolutions ?? {},
      revision: nextRevision, now: now(), actor: actor.value
    });
    if (!result.ok || !result.merged) {
      const resolutions = pendingMerge.value?.resolutions ?? {};
      pendingMerge.value = makePending(localSnapshot, remote, base, resolutions);
      try { persistSidecar(pendingMerge.value); } catch { syncError.value = '合流选择暂时无法写入浏览器存储，但当前页面已保留你的选择，请处理后重试。'; }
      return null;
    }
    return result.merged;
  }

  /** 采用来自另一页面/合流的修订：旧撤销栈属于上一修订谱系，继续撤销会退回先保存者，故清空（版本记录仍可恢复） */
  function landRevision(value: DictionarySnapshot, notice?: string) {
    adopt(value);
    baseSnapshot.value = clone(value);
    undoStack.value = [];
    redoStack.value = [];
    syncError.value = '';
    if (notice) flashNotice(notice);
  }

  /**
   * 保存工作区到浏览器。每次写入前重新读取对端修订：
   * 对端先行保存时先做词条修订合流；合流或写入失败都保留当前状态，重试时重新读取，绝不覆盖先保存者。
   */
  function syncToBrowser() {
    if (!isClient() || !hydrated.value || !baseSnapshot.value) return;
    if (pendingMerge.value) return; // 有未确认冲突时不写回
    const localSnapshot = persistableSnapshot.value;
    if (deepEqual(localSnapshot, baseSnapshot.value) && revision.value === baseSnapshot.value.revision) return;

    let remote: DictionarySnapshot | null = null;
    try {
      remote = readRemote();
    } catch {
      syncError.value = '无法读取浏览器中的词库数据（数据可能损坏）。当前编辑完整保留，请处理后重试，系统不会覆盖已有数据。';
      return;
    }

    // 对端抢先保存（含同修订号分叉：两页都从同一基版本出发各自首改）：先合流
    if (remote && (remote.revision > baseSnapshot.value.revision
      || (remote.revision === baseSnapshot.value.revision && !deepEqual(remote, baseSnapshot.value)))) {
      let merged: DictionarySnapshot | null = null;
      try {
        merged = integrateRemote(remote, localSnapshot);
      } catch (error) {
        syncError.value = `修订合流失败：${(error as Error).message}。当前编辑已保留，可重试。`;
        return;
      }
      if (!merged || pendingMerge.value) {
        flashNotice('检测到另一编校页面的修订存在同字段冲突，已并排列出；确认前不会写回。');
        return;
      }
      try {
        writeSnapshot(merged);
      } catch (error) {
        syncError.value = `合流结果写入失败（${(error as Error).message || '存储不可用'}）。双方内容与你的选择都已保留，请重试。`;
        return;
      }
      const autoCount = merged.audit.find((item) => item.id.startsWith(`audit-merge-${merged.revision}`))?.entryIds.length ?? 0;
      landRevision(merged, autoCount ? `已按词条修订自动合流：并入另一页面涉及 ${autoCount} 个词条的改动，版本记录与审校意见一并保存。` : '已与另一页面的修订合流。');
      return;
    }

    // 无人抢先，直接保存
    try {
      writeSnapshot(localSnapshot);
    } catch (error) {
      syncError.value = `写入浏览器失败（${(error as Error).message || '存储不可用'}）。刚才的编辑完整保留，点击重试会重新读取对端修订后再保存。`;
      return;
    }
    baseSnapshot.value = clone(localSnapshot);
    syncError.value = '';
  }

  /** 写入失败后重试：重新读取对端，重新合流，再写回 */
  function retrySync() {
    syncError.value = '';
    if (pendingMerge.value) { resolvePendingMerge(); return; }
    syncToBrowser();
  }

  /** 另一页面写入（storage 事件）时调用 */
  function handleExternalStorage(key: string) {
    if (!hydrated.value || !baseSnapshot.value) return;
    if (key.startsWith(PENDING_PREFIX)) return;
    if (key !== STORAGE_KEY) return;
    let remote: DictionarySnapshot | null = null;
    try { remote = readRemote(); } catch { return; }
    if (!remote) return;

    // 本页正停在冲突确认界面：刷新对端快照，重试时以最新修订合流
    if (pendingMerge.value) {
      pendingMerge.value = { ...pendingMerge.value, remote: clone(remote) };
      return;
    }

    const localSnapshot = persistableSnapshot.value;
    if (deepEqual(localSnapshot, baseSnapshot.value)) {
      // 本页没有未保存改动：直接快进到对端修订
      landRevision(remote);
      return;
    }

    // 本页也有改动：立即按词条修订合流；干净则自动写回，有冲突则挂起
    let merged: DictionarySnapshot | null = null;
    try {
      merged = integrateRemote(remote, localSnapshot);
    } catch {
      return;
    }
    if (!merged || pendingMerge.value) return;
    try {
      writeSnapshot(merged);
    } catch {
      syncError.value = '自动合流后的修订写入失败，编辑已保留，请点击重试。';
      return;
    }
    const autoCount = merged.audit.find((item) => item.id.startsWith(`audit-merge-${merged.revision}`))?.entryIds.length ?? 0;
    landRevision(merged, autoCount ? `另一页面保存了修订，已自动合流 ${autoCount} 个词条的非冲突改动。` : '已与另一页面的修订合流。');
  }

  /** 冲突对话框中更新某条冲突的选择（立即随挂起包持久化，刷新不丢） */
  function chooseResolution(path: string, choice: NonNullable<ResolutionMap[string]>['choice']) {
    const pending = pendingMerge.value;
    if (!pending) return;
    const conflict = pendingConflicts.value.find((item) => conflictPath(item) === path);
    if (!conflict) return;
    pending.resolutions[path] = { choice, signature: conflictSignature(conflict) };
    try { persistSidecar(pending); } catch { /* 内存中仍保留，重试时继续 */ }
  }

  /** 确认合流：重新读取对端最新修订、带上挂起期间本页的继续编辑再算一遍；若对端又推进过，旧选择失配的冲突重新列出 */
  function resolvePendingMerge() {
    const pending = pendingMerge.value;
    if (!pending) return;
    syncError.value = '';

    let remote: DictionarySnapshot;
    try {
      remote = readRemote() ?? pending.remote;
    } catch {
      syncError.value = '无法重新读取对端修订，当前选择已保留，请重试。';
      return;
    }

    // 挂起期间本页若继续编辑，以最新工作区作为 local 重算，避免丢失后续改动
    const liveLocal = persistableSnapshot.value;
    const localForMerge = deepEqual(liveLocal, pending.local) ? pending.local : clone(liveLocal);

    const result = threeWayMerge({
      local: localForMerge, remote, base: pending.base,
      resolutions: pending.resolutions,
      revision: Math.max(liveLocal.revision, remote.revision) + 1,
      now: now(), actor: actor.value
    });

    if (!result.ok || !result.merged) {
      // 对端又有新改动（或挂起期间的编辑引入新冲突）：重列冲突，保留仍匹配的选择
      pendingMerge.value = { ...pending, local: localForMerge, remote: clone(remote), resolutions: clone(pending.resolutions) };
      try { persistSidecar(pendingMerge.value); } catch { /* 忽略，内存仍在 */ }
      flashNotice('合流前又检测到新的差异，已重新并排列出需要确认的字段，此前可用的选择仍然保留。');
      return;
    }

    // 先序列化再写，失败时工作区与挂起包都原样保留，不会退回先保存者的内容
    try {
      writeSnapshot(result.merged);
    } catch (error) {
      syncError.value = `合流结果写入失败（${(error as Error).message || '存储不可用'}）。词条、版本记录、审校意见和合流选择都已保留，请重试。`;
      return;
    }
    landRevision(result.merged, '词条修订已合流保存：非冲突改动自动并入，冲突字段按你的选择写入。');
    pendingMerge.value = null;
    try { persistSidecar(null); } catch { /* 忽略 */ }
  }

  function createEntry() {
    const entry: DictionaryEntry = {
      id: localUid('entry'), headword: '新词条', pronunciation: '', partOfSpeech: '', definition: '', dialectVariants: [], examples: [], sources: [], synonyms: [], status: 'draft', notes: '', createdAt: now(), updatedAt: now(), reviewerComments: []
    };
    commit('新建词条', '创建草稿词条', [entry.id], () => entries.unshift(entry));
    selectedId.value = entry.id;
  }

  function updateField<K extends keyof DictionaryEntry>(entryId: string, field: K, value: DictionaryEntry[K], label = String(field)) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || JSON.stringify(entry[field]) === JSON.stringify(value)) return;
    commit('编辑字段', `${label}发生更新`, [entryId], () => { entry[field] = value; });
  }

  function setStatus(entryId: string, status: EntryStatus) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || entry.status === status) return;
    const labels: Record<EntryStatus, string> = { draft: '草稿', review: '待审', disputed: '争议', confirmed: '已确认' };
    commit('变更状态', `词条状态改为“${labels[status]}”`, [entryId], () => { entry.status = status; });
  }

  function addVariant(entryId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    const variant = { id: localUid('variant'), dialect: '', form: '', pronunciation: '', note: '' };
    commit('新增方言变体', '添加一条方言变体', [entryId], () => entry.dialectVariants.push(variant));
  }

  function updateVariant(entryId: string, variantId: string, field: 'dialect' | 'form' | 'pronunciation' | 'note', value: string) {
    const entry = entries.find((item) => item.id === entryId);
    const variant = entry?.dialectVariants.find((item) => item.id === variantId);
    if (!entry || !variant || variant[field] === value) return;
    commit('编辑方言变体', `${field}发生更新`, [entryId], () => { variant[field] = value; });
  }

  function removeVariant(entryId: string, variantId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('删除方言变体', '移除一条方言变体', [entryId], () => {
      const index = entry.dialectVariants.findIndex((variant) => variant.id === variantId);
      if (index >= 0) entry.dialectVariants.splice(index, 1);
    });
  }

  function addExample(entryId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('新增例句', '添加一条例句', [entryId], () => entry.examples.push({ id: localUid('example'), text: '', translation: '', source: '' }));
  }

  function updateExample(entryId: string, exampleId: string, field: 'text' | 'translation' | 'source', value: string) {
    const entry = entries.find((item) => item.id === entryId);
    const example = entry?.examples.find((item) => item.id === exampleId);
    if (!entry || !example || example[field] === value) return;
    commit('编辑例句', `${field}发生更新`, [entryId], () => { example[field] = value; });
  }

  function removeExample(entryId: string, exampleId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('删除例句', '移除一条例句', [entryId], () => {
      const index = entry.examples.findIndex((item) => item.id === exampleId);
      if (index >= 0) entry.examples.splice(index, 1);
    });
  }

  function addSource(entryId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('新增来源', '添加一条文献或录音来源', [entryId], () => entry.sources.push({ id: localUid('source'), title: '', citation: '', url: '' }));
  }

  function updateSource(entryId: string, sourceId: string, field: 'title' | 'citation' | 'url', value: string) {
    const entry = entries.find((item) => item.id === entryId);
    const source = entry?.sources.find((item) => item.id === sourceId);
    if (!entry || !source || source[field] === value) return;
    commit('编辑来源', `${field}发生更新`, [entryId], () => { source[field] = value; });
  }

  function removeSource(entryId: string, sourceId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('删除来源', '移除一条来源', [entryId], () => {
      const index = entry.sources.findIndex((source) => source.id === sourceId);
      if (index >= 0) entry.sources.splice(index, 1);
    });
  }

  function setSynonyms(entryId: string, synonyms: string[]) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('编辑同义词', `同义词更新为 ${synonyms.join('、')}`, [entryId], () => { entry.synonyms = synonyms; });
  }

  function addComment(entryId: string, field: string, message: string, author = '主审·和老师') {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || !message.trim()) return;
    const comment: ReviewComment = { id: localUid('comment'), field, author, message: message.trim(), status: 'open', createdAt: now(), replies: [] };
    commit('新增审校意见', `对“${field}”添加审校意见`, [entryId], () => entry.reviewerComments.unshift(comment));
  }

  function replyComment(entryId: string, commentId: string, message: string, author = '编辑·阿木') {
    const entry = entries.find((item) => item.id === entryId);
    const comment = entry?.reviewerComments.find((item) => item.id === commentId);
    if (!entry || !comment || !message.trim()) return;
    commit('回复审校意见', `回复“${comment.field}”字段意见`, [entryId], () => comment.replies.push({ id: localUid('reply'), author, message: message.trim(), createdAt: now() }));
  }

  function toggleComment(entryId: string, commentId: string) {
    const entry = entries.find((item) => item.id === entryId);
    const comment = entry?.reviewerComments.find((item) => item.id === commentId);
    if (!entry || !comment) return;
    commit('处理审校意见', comment.status === 'open' ? '标记为已解决' : '重新打开意见', [entryId], () => {
      comment.status = comment.status === 'open' ? 'resolved' : 'open';
    });
  }

  function deleteEntry(entryId: string) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;
    commit('删除词条', `删除“${entry.headword}”`, [entryId], () => {
      const index = entries.findIndex((item) => item.id === entryId);
      if (index >= 0) entries.splice(index, 1);
      selectedId.value = entries[0]?.id ?? '';
    });
  }

  function mergeEntries(targetId: string, sourceIds: string[], selected: Record<string, 'target' | 'source' | 'combine'>) {
    const target = entries.find((entry) => entry.id === targetId);
    const sources = entries.filter((entry) => sourceIds.includes(entry.id));
    if (!target || !sources.length) return;
    commit('合并重复词条', `将 ${sources.length} 个重复词条合并到“${target.headword}”`, [targetId, ...sourceIds], () => {
      sources.forEach((source) => {
        const layers: Array<keyof DictionaryEntry> = ['dialectVariants', 'examples', 'sources', 'synonyms', 'reviewerComments'];
        layers.forEach((field) => {
          const targetValue = target[field] as unknown[];
          const sourceValue = source[field] as unknown[];
          targetValue.push(...clone(sourceValue));
        });
      });
      (['headword', 'pronunciation', 'partOfSpeech', 'definition', 'notes'] as const).forEach((field) => {
        const choice = selected[field] ?? 'target';
        if (choice === 'source') target[field] = sources[0]![field];
        if (choice === 'combine' && target[field] !== sources[0]![field]) target[field] = `${target[field]}；${sources[0]![field]}`;
      });
      target.status = 'disputed';
      sourceIds.forEach((id) => {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index >= 0) entries.splice(index, 1);
      });
    });
  }

  function undo() {
    const value = undoStack.value.at(-1);
    if (!value) return;
    redoStack.value = [...redoStack.value, snapshot()];
    undoStack.value = undoStack.value.slice(0, -1);
    restore(value);
  }

  function redo() {
    const value = redoStack.value.at(-1);
    if (!value) return;
    undoStack.value = [...undoStack.value, snapshot()];
    redoStack.value = redoStack.value.slice(0, -1);
    restore(value);
  }

  function restoreVersion(versionId: string) {
    const version = versions.find((item) => item.id === versionId);
    if (!version) return;
    commit('恢复版本', `恢复 ${new Date(version.at).toLocaleString('zh-CN')} 之前的版本`, [], () => {
      entries.splice(0, entries.length, ...clone(version.before));
    });
  }

  function hydrateFromBrowser() {
    try {
      const remote = readRemote();
      const sidecar = readSidecar();
      if (sidecar) {
        // 恢复上次未确认的合流：回到当时的工作区，基快照不变，对话框重新打开
        adopt(sidecar.local);
        baseSnapshot.value = clone(sidecar.base);
        pendingMerge.value = { ...sidecar, remote: remote ? clone(remote) : sidecar.remote };
      } else if (remote) {
        adopt(remote);
        baseSnapshot.value = clone(remote);
      } else {
        baseSnapshot.value = snapshot();
        try { writeSnapshot(baseSnapshot.value); } catch { /* 首次写入失败时由编辑触发重试 */ }
      }
    } catch {
      baseSnapshot.value = snapshot();
      syncError.value = '浏览器中的词库数据无法解析，已载入内置示例且不会覆盖你的存储；请导出可用备份后再处理。';
    } finally {
      hydrated.value = true;
    }
  }

  function exportPackage() {
    return JSON.stringify({ exportedAt: now(), ...persistableSnapshot.value }, null, 2);
  }

  return {
    revision, entries, versions, audit, selectedId, hydrated, query, statusFilter, dialectFilter, fieldReplyDrafts,
    actor, pendingMerge, pendingConflicts, pendingResolvedCount, syncError, syncNotice,
    selectedEntry, filteredEntries, dialects, duplicates, openComments, persistableSnapshot,
    canUndo: computed(() => undoStack.value.length > 0), canRedo: computed(() => redoStack.value.length > 0),
    createEntry, updateField, setStatus, addVariant, updateVariant, removeVariant, addExample, updateExample, removeExample,
    addSource, updateSource, removeSource, setSynonyms, addComment, replyComment, toggleComment, deleteEntry, mergeEntries,
    undo, redo, restoreVersion, hydrateFromBrowser, exportPackage,
    syncToBrowser, retrySync, handleExternalStorage, chooseResolution, resolvePendingMerge, flashNotice,
    dismissSyncError: () => { syncError.value = ''; }
  };
});
