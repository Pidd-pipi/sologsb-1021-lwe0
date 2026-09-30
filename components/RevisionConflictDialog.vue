<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { MergeConflict } from '~/utils/merge';
import type { ConflictResolution } from '~/utils/merge';

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ conflicts: MergeConflict[] }>();
const emit = defineEmits<{ confirm: [choices: Record<string, ConflictResolution>] }>();

const choices = reactive<Record<string, ConflictResolution>>({});

watch(() => props.conflicts, (list) => {
  const ids = new Set<string>();
  list.forEach((conflict) => {
    ids.add(conflict.id);
    if (!(conflict.id in choices)) choices[conflict.id] = 'ours';
  });
  Object.keys(choices).forEach((id) => { if (!ids.has(id)) delete choices[id]; });
}, { immediate: true });

const groups = computed(() => {
  const map = new Map<string, { entryId: string; entryHeadword: string; items: MergeConflict[] }>();
  props.conflicts.forEach((conflict) => {
    let group = map.get(conflict.entryId);
    if (!group) {
      group = { entryId: conflict.entryId, entryHeadword: conflict.entryHeadword, items: [] };
      map.set(conflict.entryId, group);
    }
    group.items.push(conflict);
  });
  return [...map.values()];
});

const kindLabel = (conflict: MergeConflict): string => {
  if (conflict.kind === 'entry-delete') {
    return conflict.deletedBy === 'ours' ? '本端已删除 · 对方仍在编辑' : '对方已删除 · 本端仍在编辑';
  }
  if (conflict.kind === 'item-delete') {
    return conflict.deletedBy === 'ours' ? '本端删除子项 · 对方仍在编辑' : '对方删除子项 · 本端仍在编辑';
  }
  return '同一字段双方都基于旧值改过';
};

const deleteChoiceLabel = (conflict: MergeConflict, side: ConflictResolution): string => {
  const deletingSide = conflict.deletedBy === 'ours' ? '本端' : '对方';
  const keepingSide = conflict.deletedBy === 'ours' ? '对方' : '本端';
  if (side === conflict.deletedBy) return `接受删除（${deletingSide}已移出）`;
  return `保留${keepingSide}修改并恢复`;
};

const formatValue = (value: unknown, kind: MergeConflict['kind'], side: 'base' | 'ours' | 'theirs'): string => {
  if (value === null || value === undefined) {
    if (side !== 'base' && (kind === 'entry-delete' || kind === 'item-delete')) return '已删除';
    return '—';
  }
  if (typeof value === 'string') return value.trim() ? value : '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '（空）';
    if (typeof value[0] === 'string') return value.join('、');
    return `（${value.length} 项子记录）`;
  }
  try {
    return JSON.stringify(value, null, 1);
  } catch {
    return String(value);
  }
};

const confirm = () => {
  emit('confirm', { ...choices });
};
</script>

<template>
  <t-dialog v-model:visible="visible" header="多端修订冲突 · 逐处确认后写回" width="1080px" :footer="false" class="conflict-dialog">
    <div class="conflict-intro">
      <strong>两个页面都拿着旧快照编辑同一词条</strong>
      <span>未触碰同一字段的改动已自动并入；以下 {{ conflicts.length }} 处同字段改动或“删除 vs 继续编辑”冲突需要逐处确认。确认前不会写回本地，版本记录、审校意见与所选结果会一并保存。</span>
    </div>

    <div v-for="group in groups" :key="group.entryId" class="conflict-group">
      <div class="conflict-group-head"><span class="conflict-entry-dot" />{{ group.entryHeadword }}<small>{{ group.items.length }} 处冲突</small></div>
      <article v-for="conflict in group.items" :key="conflict.id" class="conflict-card">
        <header class="conflict-card-head">
          <t-tag size="small" theme="danger" variant="light">{{ kindLabel(conflict) }}</t-tag>
          <strong>{{ conflict.itemLabel || conflict.fieldLabel }}</strong>
          <span v-if="conflict.itemLabel" class="conflict-field-path">{{ conflict.fieldLabel }}</span>
        </header>
        <div class="conflict-columns">
          <div class="conflict-column base"><span class="column-tag">旧值（共同基线）</span><pre>{{ formatValue(conflict.baseValue, conflict.kind, 'base') }}</pre></div>
          <div class="conflict-column ours"><span class="column-tag ours">本端页面</span><pre>{{ formatValue(conflict.oursValue, conflict.kind, 'ours') }}</pre></div>
          <div class="conflict-column theirs"><span class="column-tag theirs">对方页面</span><pre>{{ formatValue(conflict.theirsValue, conflict.kind, 'theirs') }}</pre></div>
        </div>
        <t-radio-group v-model="choices[conflict.id]" variant="default" size="small" class="conflict-choices">
          <t-radio-button value="ours">
            {{ conflict.kind === 'entry-delete' || conflict.kind === 'item-delete' ? deleteChoiceLabel(conflict, 'ours') : '采用本端页面' }}
          </t-radio-button>
          <t-radio-button value="theirs">
            {{ conflict.kind === 'entry-delete' || conflict.kind === 'item-delete' ? deleteChoiceLabel(conflict, 'theirs') : '采用对方页面' }}
          </t-radio-button>
        </t-radio-group>
      </article>
    </div>

    <div class="dialog-actions">
      <t-button variant="outline" @click="visible = false">先不写回，继续编辑</t-button>
      <t-button theme="primary" @click="confirm">确认所选并写回（版本与审校意见一并保存）</t-button>
    </div>
  </t-dialog>
</template>
