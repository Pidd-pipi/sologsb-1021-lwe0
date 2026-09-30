<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';

const store = useDictionaryStore();
const activeTab = ref('basic');
const entry = computed(() => store.selectedEntry);
const synonymsText = computed(() => entry.value?.synonyms.join('、') ?? '');

const eventValue = (event: any) => typeof event === 'string' || typeof event === 'number' ? String(event) : event?.target?.value ?? event?.e?.target?.value ?? event?.value ?? '';

const commitInput = (event: any, field: 'headword' | 'pronunciation' | 'partOfSpeech' | 'definition' | 'notes') => {
  if (!entry.value) return;
  store.updateField(entry.value.id, field, eventValue(event), field);
};
</script>

<template>
  <section v-if="entry" :key="entry.id" class="panel entry-editor">
    <div class="editor-head">
      <div>
        <span class="eyebrow">02 / ENTRY EDITOR</span>
        <div class="lexeme-line"><h2>{{ entry.headword || '未命名词条' }}</h2><span>[{{ entry.pronunciation || '音标待补' }}]</span></div>
      </div>
      <div class="editor-actions">
        <t-tag :theme="entry.status === 'confirmed' ? 'success' : entry.status === 'disputed' ? 'danger' : entry.status === 'review' ? 'warning' : 'default'" variant="light">{{ entry.status }}</t-tag>
        <t-button size="small" variant="outline" @click="store.setStatus(entry.id, 'review')">提交待审</t-button>
        <t-button size="small" theme="success" @click="store.setStatus(entry.id, 'confirmed')">确认词条</t-button>
      </div>
    </div>

    <t-tabs v-model="activeTab" class="entry-tabs">
      <t-tab-panel value="basic" label="核心信息">
        <div class="editor-scroll">
          <div class="field-grid two">
            <label class="field-block"><span>词形 / 主条</span><t-input :default-value="entry.headword" @blur="commitInput($event, 'headword')" placeholder="输入民族文字、国际音标或拼音" /></label>
            <label class="field-block"><span>发音说明</span><t-input :default-value="entry.pronunciation" @blur="commitInput($event, 'pronunciation')" placeholder="声调、重音或发音人说明" /></label>
          </div>
          <div class="field-grid two compact-grid">
            <label class="field-block"><span>词性</span><t-select :model-value="entry.partOfSpeech" @change="(value) => store.updateField(entry.id, 'partOfSpeech', String(value || ''))" clearable>
              <t-option value="名词" label="名词" /><t-option value="动词" label="动词" /><t-option value="形容词" label="形容词" /><t-option value="副词" label="副词" /><t-option value="方向词" label="方向词" /><t-option value="量词" label="量词" /><t-option value="短语" label="短语" />
            </t-select></label>
            <label class="field-block"><span>同义词（用顿号分隔）</span><t-input :default-value="synonymsText" @blur="store.setSynonyms(entry.id, eventValue($event).split(/[、,，]/).map((item) => item.trim()).filter(Boolean))" placeholder="水潭、泉眼" /></label>
          </div>
          <label class="field-block"><span>释义</span><t-textarea :default-value="entry.definition" :autosize="{ minRows: 3, maxRows: 7 }" @blur="commitInput($event, 'definition')" placeholder="用简洁语言描述词义、语用限制和引申关系" /></label>
          <label class="field-block"><span>编者备注</span><t-textarea :default-value="entry.notes" :autosize="{ minRows: 2, maxRows: 5 }" @blur="commitInput($event, 'notes')" placeholder="记录不确定项、调查问题或整理说明" /></label>
        </div>
      </t-tab-panel>

      <t-tab-panel value="variants" label="方言变体">
        <div class="editor-scroll">
          <div class="section-title"><div><h3>方言与地域变体</h3><p>同一词条在不同方言点的形式、读音和限制。</p></div><t-button size="small" @click="store.addVariant(entry.id)">＋ 添加变体</t-button></div>
          <div v-for="variant in entry.dialectVariants" :key="variant.id" class="subcard">
            <button class="remove-button" title="删除变体" @click="store.removeVariant(entry.id, variant.id)">×</button>
            <div class="field-grid three">
              <label class="field-block"><span>方言点</span><t-input :default-value="variant.dialect" @blur="store.updateVariant(entry.id, variant.id, 'dialect', eventValue($event))" /></label>
              <label class="field-block"><span>词形</span><t-input :default-value="variant.form" @blur="store.updateVariant(entry.id, variant.id, 'form', eventValue($event))" /></label>
              <label class="field-block"><span>读音</span><t-input :default-value="variant.pronunciation" @blur="store.updateVariant(entry.id, variant.id, 'pronunciation', eventValue($event))" /></label>
            </div>
            <label class="field-block"><span>使用说明</span><t-input :default-value="variant.note" @blur="store.updateVariant(entry.id, variant.id, 'note', eventValue($event))" /></label>
          </div>
          <t-empty v-if="!entry.dialectVariants.length" description="暂未记录方言变体" />
        </div>
      </t-tab-panel>

      <t-tab-panel value="examples" label="例句">
        <div class="editor-scroll">
          <div class="section-title"><div><h3>自然语料例句</h3><p>保留原文、译文和出处，便于核对词语的真实用法。</p></div><t-button size="small" @click="store.addExample(entry.id)">＋ 添加例句</t-button></div>
          <div v-for="(example, index) in entry.examples" :key="example.id" class="subcard example-card">
            <button class="remove-button" @click="store.removeExample(entry.id, example.id)">×</button>
            <span class="card-index">EX {{ String(index + 1).padStart(2, '0') }}</span>
            <label class="field-block"><span>原文</span><t-textarea :default-value="example.text" :autosize="{ minRows: 2, maxRows: 4 }" @blur="store.updateExample(entry.id, example.id, 'text', eventValue($event))" /></label>
            <div class="field-grid two"><label class="field-block"><span>译文</span><t-input :default-value="example.translation" @blur="store.updateExample(entry.id, example.id, 'translation', eventValue($event))" /></label><label class="field-block"><span>出处</span><t-input :default-value="example.source" @blur="store.updateExample(entry.id, example.id, 'source', eventValue($event))" /></label></div>
          </div>
          <t-empty v-if="!entry.examples.length" description="暂未记录例句" />
        </div>
      </t-tab-panel>

      <t-tab-panel value="sources" label="来源">
        <div class="editor-scroll">
          <div class="section-title"><div><h3>文献、录音与调查来源</h3><p>删除或改写引用时会先检查是否影响其他词条。</p></div><t-button size="small" @click="store.addSource(entry.id)">＋ 添加来源</t-button></div>
          <div v-for="source in entry.sources" :key="source.id" class="subcard source-card">
            <button class="remove-button" @click="store.removeSource(entry.id, source.id)">×</button>
            <div class="field-grid two"><label class="field-block"><span>来源名称</span><t-input :default-value="source.title" @blur="store.updateSource(entry.id, source.id, 'title', eventValue($event))" /></label><label class="field-block"><span>链接（可选）</span><t-input :default-value="source.url" @blur="store.updateSource(entry.id, source.id, 'url', eventValue($event))" /></label></div>
            <label class="field-block"><span>引用信息</span><t-input :default-value="source.citation" @blur="store.updateSource(entry.id, source.id, 'citation', eventValue($event))" /></label>
          </div>
          <t-empty v-if="!entry.sources.length" description="暂未记录来源" />
        </div>
      </t-tab-panel>
    </t-tabs>
  </section>
</template>
