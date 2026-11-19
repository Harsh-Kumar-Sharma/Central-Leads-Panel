<script setup>
defineProps({ label: String, color: { type: String, default: '#64748b' } });
</script>

<template>
  <span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap" :style="{ background: color + '1f', color }">
    {{ label }}
  </span>
</template>
