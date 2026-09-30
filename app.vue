<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';

const store = useDictionaryStore();
let stopPersistence: (() => void) | undefined;

const onStorage = (event: StorageEvent) => {
  if (event.key) store.handleExternalStorage(event.key);
};

const onFocus = () => {
  if (store.syncError) store.retrySync();
  else store.syncToBrowser();
};

onMounted(() => {
  store.hydrateFromBrowser();
  stopPersistence = watch(
    () => store.persistableSnapshot,
    () => store.syncToBrowser(),
    { deep: true }
  );
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);
});

onBeforeUnmount(() => {
  stopPersistence?.();
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('focus', onFocus);
});
</script>

<template>
  <NuxtPage />
</template>
