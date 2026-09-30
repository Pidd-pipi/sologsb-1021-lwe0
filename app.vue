<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';

const store = useDictionaryStore();
let stopPersistence: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  store.hydrateFromBrowser();
  // 编辑后不直接整份写回：交给多端合流按词条修订合并，冲突未确认前不写回。
  stopPersistence = watch(
    () => store.persistableSnapshot,
    () => {
      if (!store.hydrated) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void store.persist(); }, 450);
    },
    { deep: true }
  );
  // 其他端写入或本端重新可见时，也按基线合流一次，避免拿着旧快照继续编辑。
  window.addEventListener('storage', syncFromStorage);
  document.addEventListener('visibilitychange', syncFromStorage);
});

const syncFromStorage = () => {
  if (!store.hydrated) return;
  if (document.visibilityState === 'hidden') return;
  void store.persist();
};

onBeforeUnmount(() => {
  stopPersistence?.();
  if (saveTimer) clearTimeout(saveTimer);
  window.removeEventListener('storage', syncFromStorage);
  document.removeEventListener('visibilitychange', syncFromStorage);
});
</script>

<template>
  <NuxtPage />
</template>
