<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps({ title: String, wide: Boolean });
const emit = defineEmits(['close']);
const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-[2px] sm:p-8" @mousedown.self="emit('close')">
    <div class="card my-auto w-full" :class="props.wide ? 'max-w-3xl' : 'max-w-lg'" role="dialog" aria-modal="true" :aria-label="title">
      <div class="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button class="btn-ghost rounded-lg p-1.5" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </div>
      <div class="p-5"><slot /></div>
      <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-4"><slot name="footer" /></div>
    </div>
  </div>
</template>
