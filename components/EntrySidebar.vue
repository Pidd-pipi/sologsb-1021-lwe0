<script setup lang="ts">
import { useDictionaryStore } from '~/store/dictionary';

const store = useDictionaryStore();
const emit = defineEmits<{ create: []; duplicates: []; versions: [] }>();

const statusMeta = {
  draft: { label: '草稿', theme: 'default' },
  review: { label: '待审', theme: 'warning' },
  disputed: { label: '争议', theme: 'danger' },
  confirmed: { label: '已确认', theme: 'success' }
} as const;
</script>

<template>
  <aside class="panel entry-sidebar">
    <div class="panel-head">
      <div><span class="eyebrow">01 / LEXICON</span><h2>词条库</h2></div>
      <t-button size="small" theme="primary" @click="emit('create')">＋ 新词条</t-button>
    </div>
    <div class="sidebar-tools">
      <t-input v-model="store.query" class="search-input" clearable placeholder="搜索词形、释义、来源…（/）">
        <template #prefix-icon><span class="search-mark">⌕</span></template>
      </t-input>
      <div class="filter-row">
        <t-select v-model="store.statusFilter" size="small" :popup-props="{ attach: 'body' }">
          <t-option value="all" label="全部状态" />
          <t-option value="draft" label="草稿" />
          <t-option value="review" label="待审" />
          <t-option value="disputed" label="争议" />
          <t-option value="confirmed" label="已确认" />
        </t-select>
        <t-select v-model="store.dialectFilter" size="small" :popup-props="{ attach: 'body' }">
          <t-option value="all" label="全部方言" />
          <t-option v-for="dialect in store.dialects" :key="dialect" :value="dialect" :label="dialect" />
        </t-select>
      </div>
    </div>
    <div class="entry-list">
      <button
        v-for="entry in store.filteredEntries"
        :key="entry.id"
        class="entry-card"
        :class="{ active: entry.id === store.selectedId }"
        @click="store.selectedId = entry.id"
      >
        <div class="entry-card-top">
          <strong>{{ entry.headword || '未命名词条' }}</strong>
          <t-tag size="small" variant="light" :theme="statusMeta[entry.status].theme">{{ statusMeta[entry.status].label }}</t-tag>
        </div>
        <div class="pronunciation">[{{ entry.pronunciation || '待补音' }}] · {{ entry.partOfSpeech || '词性待定' }}</div>
        <p>{{ entry.definition || '尚未填写释义' }}</p>
        <div class="entry-card-meta">
          <span>{{ entry.dialectVariants.length }} 方言变体</span>
          <span>{{ entry.examples.length }} 例句</span>
          <span v-if="entry.reviewerComments.filter((item) => item.status === 'open').length" class="comment-count">{{ entry.reviewerComments.filter((item) => item.status === 'open').length }} 条意见</span>
        </div>
      </button>
      <t-empty v-if="!store.filteredEntries.length" description="没有符合条件的词条" />
    </div>
    <div class="sidebar-footer">
      <button class="text-action" @click="emit('duplicates')"><span>{{ store.duplicates.length }}</span> 组疑似重复</button>
      <button class="text-action" @click="emit('versions')"><span>{{ store.versions.length }}</span> 条版本记录</button>
    </div>
  </aside>
</template>
