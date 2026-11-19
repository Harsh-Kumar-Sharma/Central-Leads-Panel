<script setup>
defineProps({ modelValue: Boolean, label: String, disabled: Boolean });
const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <label class="inline-flex cursor-pointer select-none items-center gap-3" :class="disabled ? 'opacity-50 pointer-events-none' : ''">
    <button
      type="button" role="switch" :aria-checked="modelValue" :disabled="disabled"
      class="relative h-6 w-11 rounded-full transition-colors"
      :class="modelValue ? 'bg-primary' : 'bg-line'"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" :class="modelValue ? 'translate-x-5' : ''" />
    </button>
    <span class="text-sm">{{ label }}</span>
  </label>
</template>
