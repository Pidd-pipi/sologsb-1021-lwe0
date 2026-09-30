import { mergeSnapshots, applyConflictResolutions, buildMergeAudit } from '../utils/merge';
import type { DictionaryEntry, DictionarySnapshot } from '../types/dictionary';

const makeEntry = (over: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  id: 'e1',
  headword: 'ŋgɨ³³',
  pronunciation: 'ŋgɨ˧˧',
  partOfSpeech: '名词',
  definition: '小水潭',
  dialectVariants: [{ id: 'v1', dialect: '北坡话', form: 'ŋgɨ³³ tsha⁵⁵', pronunciation: 'ŋgɨ tsha', note: '泉水源头' }],
  examples: [{ id: 'ex1', text: 'a³³ ŋgɨ³³ ma³³.', translation: '水潭是甜的。', source: '民间故事' }],
  sources: [{ id: 's1', title: '北坡词汇表', citation: '1987 手稿', url: '' }],
  synonyms: ['水潭'],
  status: 'draft',
  notes: '',
  createdAt: '2024-08-11T04:00:00.000Z',
  updatedAt: '2025-03-09T06:12:00.000Z',
  reviewerComments: [{ id: 'c1', field: 'definition', author: '和老师', message: '请补充例句', status: 'open', createdAt: '2025-02-18T02:00:00.000Z', replies: [] }],
  ...over
});

const snap = (entries: DictionaryEntry[], revision: number): DictionarySnapshot => ({
  revision,
  entries,
  versions: [],
  audit: []
});

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
};

// 场景 1：甲补释义、乙改发音，没碰同一字段 → 自动并入
{
  const base = snap([makeEntry()], 1);
  const ours = snap([makeEntry({ definition: '山间常年不涸的小水潭；也比喻安静可靠的人。' })], 2);
  const theirs = snap([makeEntry({ pronunciation: 'ŋgɨ˧˧（低平调）' })], 3);
  const result = mergeSnapshots(base, ours, theirs);
  check('场景1 无冲突', result.conflicts.length === 0);
  check('场景1 并入甲方释义', result.snapshot.entries[0]!.definition.includes('安静可靠'));
  check('场景1 并入乙方发音', result.snapshot.entries[0]!.pronunciation.includes('低平调'));
  check('场景1 修订号跳升', result.snapshot.revision === 4);
  check('场景1 自动计数=2', result.autoCount === 2);
}

// 场景 2：两边都基于旧值改了释义 → 冲突，并排列出
{
  const base = snap([makeEntry()], 1);
  const ours = snap([makeEntry({ definition: '山间小水潭。' })], 2);
  const theirs = snap([makeEntry({ definition: '泉水涌出的地方。' })], 3);
  const result = mergeSnapshots(base, ours, theirs);
  check('场景2 有1处冲突', result.conflicts.length === 1);
  check('场景2 冲突字段=definition', result.conflicts[0]!.field === 'definition');
  check('场景2 含旧值/我方/对方三列', result.conflicts[0]!.baseValue === '小水潭' && result.conflicts[0]!.oursValue === '山间小水潭。' && result.conflicts[0]!.theirsValue === '泉水涌出的地方。');
  const resolved = applyConflictResolutions(result.snapshot, result.conflicts, { [result.conflicts[0]!.id]: 'theirs' });
  check('场景2 确认采用对方后写回对方值', resolved.entries[0]!.definition === '泉水涌出的地方。');
  const audit = buildMergeAudit(result.conflicts, { [result.conflicts[0]!.id]: 'theirs' }, result.autoCount, result.changedEntryIds);
  check('场景2 审计记录所选结果', audit.action === '多端修订合流' && audit.detail.includes('采用我方 0') && audit.detail.includes('采用对方 1'));
}

// 场景 3：一边移出词条、一边继续编辑 → 删除 vs 编辑 冲突
{
  const base = snap([makeEntry()], 1);
  const ours = snap([], 2); // 本端删除
  const theirs = snap([makeEntry({ definition: '继续补充释义。', pronunciation: 'ŋgɨ˥' })], 3); // 对方继续编辑
  const result = mergeSnapshots(base, ours, theirs);
  check('场景3 有1处冲突', result.conflicts.length === 1);
  check('场景3 类型=entry-delete', result.conflicts[0]!.kind === 'entry-delete');
  check('场景3 删除方=ours', result.conflicts[0]!.deletedBy === 'ours');
  const keep = applyConflictResolutions(result.snapshot, result.conflicts, { [result.conflicts[0]!.id]: 'theirs' });
  check('场景3 选择保留后词条仍在且带对方修改', keep.entries.length === 1 && keep.entries[0]!.definition === '继续补充释义。');
  const del = applyConflictResolutions(result.snapshot, result.conflicts, { [result.conflicts[0]!.id]: 'ours' });
  check('场景3 选择接受删除后词条移除', del.entries.length === 0);
}

// 场景 4：对方删除一条变体，本端同时改了这条变体的读音 → 子项删除冲突
{
  const base = snap([makeEntry()], 1);
  const ours = snap([makeEntry({ dialectVariants: [{ id: 'v1', dialect: '北坡话', form: 'ŋgɨ³³ tsha⁵⁵', pronunciation: 'ŋgɨ tsha˥', note: '强调泉水源头' }] })], 2);
  const theirs = snap([makeEntry({ dialectVariants: [] })], 3);
  const result = mergeSnapshots(base, ours, theirs);
  check('场景4 有1处冲突', result.conflicts.length === 1);
  check('场景4 类型=item-delete', result.conflicts[0]!.kind === 'item-delete');
  check('场景4 删除方=theirs', result.conflicts[0]!.deletedBy === 'theirs');
  const keep = applyConflictResolutions(result.snapshot, result.conflicts, { [result.conflicts[0]!.id]: 'ours' });
  check('场景4 保留后变体仍在且带本端读音', keep.entries[0]!.dialectVariants.length === 1 && keep.entries[0]!.dialectVariants[0]!.pronunciation === 'ŋgɨ tsha˥');
}

// 场景 5：一方新增审校意见，另一方回复旧意见 → 意见与回复都保留
{
  const baseComments = [{ id: 'c1', field: 'definition', author: '和老师', message: '请补充例句', status: 'open' as const, createdAt: '2025-02-18T02:00:00.000Z', replies: [] }];
  const base = snap([makeEntry({ reviewerComments: baseComments })], 1);
  const ours = snap([makeEntry({ reviewerComments: [...baseComments, { id: 'c2', field: 'pronunciation', author: '罗老师', message: '请补发音人', status: 'open' as const, createdAt: '2025-03-01T00:00:00.000Z', replies: [] }] })], 2);
  const theirs = snap([makeEntry({ reviewerComments: [{ id: 'c1', field: 'definition', author: '和老师', message: '请补充例句', status: 'open' as const, createdAt: '2025-02-18T02:00:00.000Z', replies: [{ id: 'r1', author: '阿木', message: '已补', createdAt: '2025-03-02T00:00:00.000Z' }] }] })], 3);
  const result = mergeSnapshots(base, ours, theirs);
  check('场景5 无冲突', result.conflicts.length === 0);
  check('场景5 两条意见都在', result.snapshot.entries[0]!.reviewerComments.length === 2);
  check('场景5 回复保留在原意见下', result.snapshot.entries[0]!.reviewerComments.find((c) => c.id === 'c1')!.replies.length === 1);
}

// 场景 6：版本记录双方并集，不丢失先保存内容
{
  const v = (id: string, at: string) => ({ id, at, action: '编辑字段', detail: '', before: [] });
  const base = snap([makeEntry()], 1);
  const ours: DictionarySnapshot = { revision: 2, entries: [makeEntry()], versions: [v('v2', '2025-03-02T00:00:00.000Z')], audit: [] };
  const theirs: DictionarySnapshot = { revision: 2, entries: [makeEntry()], versions: [v('v9', '2025-03-03T00:00:00.000Z')], audit: [] };
  const result = mergeSnapshots(base, ours, theirs);
  check('场景6 版本记录并集', result.snapshot.versions.map((x) => x.id).sort().join(',') === 'v2,v9');
}

// 场景 7：双方各自新增不同词条 → 都保留
{
  const base = snap([], 1);
  const ours = snap([makeEntry({ id: 'eA', headword: 'a³³' })], 2);
  const theirs = snap([makeEntry({ id: 'eB', headword: 'bo⁵⁵' })], 2);
  const result = mergeSnapshots(base, ours, theirs);
  check('场景7 无冲突', result.conflicts.length === 0);
  check('场景7 两条新词条都在', result.snapshot.entries.map((e) => e.id).sort().join(',') === 'eA,eB');
}

console.log(`\n${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
