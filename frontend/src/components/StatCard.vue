<script setup>
import AppIcon from './AppIcon.vue';
defineProps({
  label: String,
  value: [Number, String],
  icon: String,
  accent: { type: String, default: '#6366f1' },
  hint: String,
  loading: Boolean,
});
</script>

<template>
  <div class="card relative overflow-hidden p-5">
    <div class="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl" :style="{ background: accent }" />
    <div class="flex items-start justify-between">
      <div>
        <div class="text-sm font-medium text-muted">{{ label }}</div>
        <div v-if="loading" class="mt-3 h-8 w-16 rounded-lg bg-surface-2 animate-pulse" />
        <div v-else class="mt-2 text-3xl font-bold tabular-nums">{{ value }}</div>
        <div v-if="hint" class="mt-1 text-xs text-muted">{{ hint }}</div>
      </div>
      <div class="h-11 w-11 rounded-xl grid place-items-center" :style="{ background: accent + '22', color: accent }">
        <AppIcon :name="icon" :size="22" />
      </div>
    </div>
  </div>
</template>
