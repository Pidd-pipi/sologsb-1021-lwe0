<script setup lang="ts">
import { computed, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';
import { FIELD_LABELS, STATUS_LABELS, conflictPath, type ConflictResolution, type MergeConflict } from '~/types/merge';
import { conflictSignature, previewValue } from '~/utils/merge';

const visible = defineModel<boolean>({ required: true });
const store = useDictionaryStore();

const conflicts = computed(() => store.pendingConflicts);
const grouped = computed(() => {
  const groups = new Map<string, { headword: string; items: MergeConflict[] }>();
  conflicts.value.forEach((conflict) => {
    let group = groups.get(conflict.entryId);
    if (!group) { group = { headword: conflict.headword || '未命名词条', items: [] }; groups.set(conflict.entryId, group); }
    group.items.push(conflict);
  });
  return [...groups.entries()].map(([entryId, value]) => ({ entryId, ...value }));
});

const totalCount = computed(() => conflicts.value.length);
const resolvedCount = computed(() => store.pendingResolvedCount);
const canConfirm = computed(() => totalCount.value > 0 && resolvedCount.value === totalCount.value);

const selectionOf = (conflict: MergeConflict): ConflictResolution | undefined => store.pendingMerge?.resolutions[conflictPath(conflict)];
const isResolved = (conflict: MergeConflict) => {
  const resolution = selectionOf(conflict);
  return Boolean(resolution && resolution.signature === conflictSignature(conflict));
};

const fieldChoice = (conflict: MergeConflict) => {
  const resolution = selectionOf(conflict);
  if (resolution?.choice === 'local') return 'mine';
  if (resolution?.choice === 'remote') return 'theirs';
  return '';
};
const deleteChoice = (conflict: MergeConflict) => {
  const resolution = selectionOf(conflict);
  return resolution?.choice === 'keep' || resolution?.choice === 'remove' ? resolution.choice : '';
};
const createChoice = (conflict: MergeConflict) => {
  const resolution = selectionOf(conflict);
  return resolution?.choice === 'rename-local' || resolution?.choice === 'rename-remote' ? resolution.choice : '';
};

const choose = (path: string, choice: ConflictResolution['choice']) => store.chooseResolution(path, choice);

const confirmMerge = () => {
  if (!canConfirm.value) return;
  store.resolvePendingMerge();
  if (!store.pendingMerge) visible.value = false;
};

const fieldLabel = (conflict: MergeConflict) => conflict.kind === 'field' ? FIELD_LABELS[conflict.field] : '词条去留';
const formatStatus = (value: unknown, field?: string) => {
  if (field === 'status' && typeof value === 'string') return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? String(value);
  return previewValue(value, field);
};
</script>

<template>
  <t-dialog v-model:visible="visible" header="多人修订合流 · 并排确认" width="1080px" :footer="false" :close-on-overlay-click="false" class="revision-merge-dialog">
    <div v-if="store.pendingMerge" class="revise-content">
      <t-alert theme="warning" title="另一编校页面与你改了同一份词库">
        互不重叠的字段改动已自动并入；以下字段两侧都基于旧值改过（或一侧移出、另一侧继续编辑），请逐条并排确认后才会写回。版本记录、审校意见和你的选择会随合流结果一起保存。
      </t-alert>

      <div class="revise-meta">
        <span>合流前 r{{ store.pendingMerge.base.revision }} · 本页 r{{ store.pendingMerge.local.revision }} · 另一页 r{{ store.pendingMerge.remote.revision }}</span>
        <span>待确认 <strong>{{ totalCount - resolvedCount }}</strong> / {{ totalCount }} 处</span>
        <span v-if="resolvedCount === totalCount && totalCount" class="all-set">全部已选，可以写回</span>
      </div>

      <div v-for="group in grouped" :key="group.entryId" class="revise-group">
        <div class="revise-group-head"><span class="revise-index">词条</span><strong>{{ group.headword }}</strong><small>{{ group.entryId }}</small></div>

        <div v-for="conflict in group.items" :key="conflictPath(conflict)" class="conflict-card" :class="{ resolved: isResolved(conflict) }">
          <div class="conflict-title">
            <strong>{{ fieldLabel(conflict) }}</strong>
            <span v-if="conflict.kind === 'delete-edit'" class="conflict-tag">移出 / 继续编辑</span>
            <span v-else-if="conflict.kind === 'create-create'" class="conflict-tag">新建撞号</span>
            <span v-else class="conflict-tag">同字段双方都已修改</span>
            <span v-if="isResolved(conflict)" class="resolved-tag">已选择</span>
          </div>

          <!-- 字段冲突 -->
          <template v-if="conflict.kind === 'field'">
            <div class="three-cols">
              <div class="three-col old"><span>合流前旧值</span><pre>{{ formatStatus(conflict.base, conflict.field) || '（空）' }}</pre></div>
              <div class="three-col mine" :class="{ chosen: fieldChoice(conflict) === 'mine' }"><span>本页面的修改</span><pre>{{ formatStatus(conflict.local, conflict.field) || '（空）' }}</pre></div>
              <div class="three-col theirs" :class="{ chosen: fieldChoice(conflict) === 'theirs' }"><span>另一页面的修改</span><pre>{{ formatStatus(conflict.remote, conflict.field) || '（空）' }}</pre></div>
            </div>
            <t-radio-group :value="fieldChoice(conflict)" variant="default-filled"
              @change="(value: string | number | boolean) => choose(conflictPath(conflict), value === 'mine' ? 'local' : 'remote')">
              <t-radio-button value="mine">采用本页面</t-radio-button>
              <t-radio-button value="theirs">采用另一页面</t-radio-button>
            </t-radio-group>
          </template>

          <!-- 删除 / 继续编辑冲突 -->
          <template v-else-if="conflict.kind === 'delete-edit'">
            <div class="three-cols">
              <div class="three-col old"><span>合流前词条</span><pre>{{ `${formatStatus(conflict.base.definition)}\n状态：${STATUS_LABELS[conflict.base.status]}` }}</pre></div>
              <div v-if="conflict.side === 'editor'" class="three-col mine" :class="{ chosen: deleteChoice(conflict) === 'keep' }"><span>本页面继续编辑</span><pre>{{ `词形：${conflict.edited.headword}\n释义：${conflict.edited.definition}` }}</pre></div>
              <div v-else class="three-col theirs" :class="{ chosen: deleteChoice(conflict) === 'keep' }"><span>另一页面继续编辑</span><pre>{{ `词形：${conflict.edited.headword}\n释义：${conflict.edited.definition}` }}</pre></div>
              <div class="three-col removed" :class="{ chosen: deleteChoice(conflict) === 'remove' }"><span>{{ conflict.side === 'editor' ? '另一页面已移出' : '本页面已移出' }}</span><pre>确认移出后该词条不再显示（版本记录仍可恢复）</pre></div>
            </div>
            <t-radio-group :value="deleteChoice(conflict)" variant="default-filled"
              @change="(value: string | number | boolean) => choose(conflictPath(conflict), value === 'keep' ? 'keep' : 'remove')">
              <t-radio-button value="keep">保留继续编辑的词条</t-radio-button>
              <t-radio-button value="remove">确认移出（可从版本恢复）</t-radio-button>
            </t-radio-group>
          </template>

          <!-- 新建撞号 -->
          <template v-else>
            <div class="three-cols two-cols">
              <div class="three-col mine" :class="{ chosen: createChoice(conflict) === 'rename-local' }"><span>本页面新建</span><pre>{{ `词形：${conflict.local.headword}\n释义：${conflict.local.definition}` }}</pre></div>
              <div class="three-col theirs" :class="{ chosen: createChoice(conflict) === 'rename-remote' }"><span>另一页面新建</span><pre>{{ `词形：${conflict.remote.headword}\n释义：${conflict.remote.definition}` }}</pre></div>
            </div>
            <t-radio-group :value="createChoice(conflict)" variant="default-filled"
              @change="(value: string | number | boolean) => choose(conflictPath(conflict), value === 'rename-local' ? 'rename-local' : 'rename-remote')">
              <t-radio-button value="rename-local">两条都保留，给本页新建条重新编号</t-radio-button>
              <t-radio-button value="rename-remote">两条都保留，给另一页新建条重新编号</t-radio-button>
            </t-radio-group>
          </template>
        </div>
      </div>

      <t-alert v-if="store.syncError" theme="error" :title="store.syncError" class="revise-error">
        <t-button size="small" theme="danger" variant="outline" @click="store.retrySync">重新读取对端并重试</t-button>
      </t-alert>

      <div class="dialog-actions revise-actions">
        <t-button variant="outline" @click="visible = false">稍后处理（选择已随工作区暂存）</t-button>
        <t-button theme="primary" :disabled="!canConfirm" @click="confirmMerge">确认选择并合流写回</t-button>
      </div>
    </div>
    <t-empty v-else description="没有待确认的合流冲突" />
  </t-dialog>
</template>
