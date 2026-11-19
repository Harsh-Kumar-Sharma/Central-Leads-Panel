<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] }, // [{ value, label, color? }]
  placeholder: { type: String, default: 'All' },
  label: String,
});
const emit = defineEmits(['update:modelValue']);
const open = ref(false);
const root = ref(null);

const summary = computed(() => {
  if (!props.modelValue.length) return props.placeholder;
  if (props.modelValue.length === 1) return props.options.find((o) => o.value === props.modelValue[0])?.label || '1 selected';
  return `${props.modelValue.length} selected`;
});

function toggle(v) {
  const set = new Set(props.modelValue);
  set.has(v) ? set.delete(v) : set.add(v);
  emit('update:modelValue', props.options.map((o) => o.value).filter((x) => set.has(x)));
}
const onDoc = (e) => { if (root.value && !root.value.contains(e.target)) open.value = false; };
onMounted(() => document.addEventListener('mousedown', onDoc));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc));
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button" class="input flex items-center justify-between gap-2 text-left"
      :aria-label="label" :aria-expanded="open" @click="open = !open" @keydown.esc="open = false"
    >
      <span class="truncate" :class="modelValue.length ? '' : 'text-muted'">{{ summary }}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-muted"><path d="M7 10l5 5 5-5z" /></svg>
    </button>
    <div v-if="open" class="absolute z-30 mt-1 w-full min-w-[12rem] max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
      <div v-if="!options.length" class="px-3 py-2 text-sm text-muted">No options</div>
      <label
        v-for="o in options" :key="o.value"
        class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
      >
        <input type="checkbox" class="accent-[var(--primary)]" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
        <span v-if="o.color" class="h-2 w-2 rounded-full" :style="{ background: o.color }" />
        <span class="truncate">{{ o.label }}</span>
      </label>
      <button v-if="modelValue.length" type="button" class="mt-1 w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-primary hover:bg-surface-2" @click="emit('update:modelValue', [])">Clear selection</button>
    </div>
  </div>
</template>
