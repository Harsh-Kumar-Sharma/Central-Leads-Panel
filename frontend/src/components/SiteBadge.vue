<script setup>
defineProps({ name: String, color: { type: String, default: '#6366f1' } });
</script>

<template>
  <span
    class="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
    :style="{ background: color + '22', color, boxShadow: `inset 0 0 0 1px ${color}44` }"
    :title="name"
  >
    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: color }" />
    <span class="truncate">{{ name }}</span>
  </span>
</template>
