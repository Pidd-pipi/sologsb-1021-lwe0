<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useDictionaryStore } from '~/store/dictionary';

const store = useDictionaryStore();
let stopPersistence: (() => void) | undefined;

onMounted(() => {
  store.hydrateFromBrowser();
  stopPersistence = watch(
    () => store.persistableSnapshot,
    (value) => {
      if (store.hydrated) localStorage.setItem('sologsb-1021-dictionary-v1', JSON.stringify(value));
    },
    { deep: true }
  );
});

onBeforeUnmount(() => stopPersistence?.());
</script>

<template>
  <NuxtPage />
</template>
