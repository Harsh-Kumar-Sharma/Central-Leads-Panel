<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useTheme, ACCENTS, MODES } from '../utils/theme';
import AppIcon from './AppIcon.vue';

const { mode, accent, setMode, setAccent } = useTheme();
const open = ref(false);
const root = ref(null);

const onDocDown = (e) => { if (root.value && !root.value.contains(e.target)) open.value = false; };
const onKey = (e) => { if (e.key === 'Escape') open.value = false; };
onMounted(() => { document.addEventListener('mousedown', onDocDown); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); });

function reset() {
  setAccent('indigo');
  setMode('system');
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="icon-btn grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition hover:text-ink"
      :class="open ? '!text-primary !border-primary/50' : ''"
      aria-haspopup="dialog" :aria-expanded="open" aria-label="Appearance settings" title="Appearance"
      @click="open = !open"
    >
      <AppIcon name="palette" :size="19" />
    </button>

    <Transition enter-from-class="opacity-0 -translate-y-1 scale-95" leave-to-class="opacity-0 -translate-y-1 scale-95" enter-active-class="transition duration-150 ease-out" leave-active-class="transition duration-100 ease-in">
      <div
        v-if="open"
        class="panel absolute right-0 mt-2 w-[19rem] origin-top-right rounded-2xl border border-line bg-surface shadow-2xl max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:w-auto"
        role="dialog" aria-label="Appearance"
      >
        <div class="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div class="text-sm font-semibold">Appearance</div>
            <div class="text-[11px] text-muted">Saved on this device</div>
          </div>
          <button class="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink" @click="reset">Reset</button>
        </div>

        <!-- Mode -->
        <div class="px-4 pt-4">
          <div class="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Mode</div>
          <div class="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2 p-1" role="radiogroup" aria-label="Colour mode">
            <button
              v-for="m in MODES" :key="m.value"
              class="flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition"
              :class="mode === m.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'"
              role="radio" :aria-checked="mode === m.value"
              @click="setMode(m.value)"
            >
              <AppIcon :name="m.icon" :size="15" /> {{ m.label }}
            </button>
          </div>
        </div>

        <!-- Accent palettes -->
        <div class="p-4">
          <div class="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Colour theme</div>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Colour theme">
            <button
              v-for="a in ACCENTS" :key="a.value"
              class="group relative overflow-hidden rounded-xl border p-2.5 text-left transition"
              :class="accent === a.value ? 'border-transparent' : 'border-line hover:border-muted/40'"
              :style="accent === a.value ? { boxShadow: `0 0 0 2px ${a.from}` } : null"
              role="radio" :aria-checked="accent === a.value" :aria-label="`${a.label} colour theme – ${a.desc}`"
              @click="setAccent(a.value)"
            >
              <!-- mini preview of the UI in this palette -->
              <div class="mb-2 flex h-10 overflow-hidden rounded-lg border border-line bg-bg">
                <div class="flex w-5 flex-col items-center gap-1 bg-surface pt-1.5">
                  <span class="h-1.5 w-2.5 rounded-sm" :style="{ background: a.from }" />
                  <span class="h-1 w-2.5 rounded-sm bg-line" />
                  <span class="h-1 w-2.5 rounded-sm bg-line" />
                </div>
                <div class="flex flex-1 flex-col justify-center gap-1 px-1.5">
                  <span class="h-1 w-10 rounded-full bg-line" />
                  <span class="h-2.5 w-12 rounded" :style="{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }" />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="h-4 w-4 shrink-0 rounded-full" :style="{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }" />
                <div class="min-w-0">
                  <div class="text-xs font-semibold">{{ a.label }}</div>
                  <div class="truncate text-[10px] text-muted">{{ a.desc }}</div>
                </div>
              </div>
              <span
                v-if="accent === a.value"
                class="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-white shadow"
                :style="{ background: a.from }"
              ><AppIcon name="check" :size="13" /></span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.icon-btn { background: var(--surface); }
.icon-btn:hover { background: var(--surface-2); }
</style>
