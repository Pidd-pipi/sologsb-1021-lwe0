<script setup lang="ts">
import type { DictionaryEntry } from '~/types/dictionary';

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ entry: DictionaryEntry | null; impacts: DictionaryEntry[] }>();
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <t-dialog v-model:visible="visible" header="删除词条前的引用检查" width="650px" :footer="false">
    <div v-if="entry" class="delete-check">
      <div class="delete-target"><span>准备删除</span><strong>{{ entry.headword }}</strong><p>{{ entry.definition }}</p></div>
      <t-alert v-if="impacts.length" theme="warning" :title="`检测到 ${impacts.length} 个词条可能引用此条`">
        删除后这些引用不会自动改写。请先核对影响范围，必要时取消删除并在对应词条中调整同义词、释义或例句出处。
      </t-alert>
      <t-alert v-else theme="success" title="未发现其他词条直接引用">该词条仍可从版本记录恢复，删除操作也支持撤销。</t-alert>
      <div v-if="impacts.length" class="impact-list">
        <article v-for="impact in impacts" :key="impact.id">
          <strong>{{ impact.headword }}</strong>
          <span>{{ impact.definition }}</span>
          <small>同义词：{{ impact.synonyms.join('、') || '无' }}</small>
        </article>
      </div>
      <div class="dialog-actions"><t-button variant="outline" @click="visible = false">取消</t-button><t-button theme="danger" @click="emit('confirm')">仍然删除并记录影响</t-button></div>
    </div>
  </t-dialog>
</template>
