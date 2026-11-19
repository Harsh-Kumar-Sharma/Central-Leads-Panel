<script setup>
import { onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '../stores/notifications';
import AppIcon from './AppIcon.vue';

const store = useNotificationsStore();
const router = useRouter();

// Each toast auto-dismisses; hovering pauses the timer so it can be read.
const timers = new Map();
function arm(t, ms = t.duration) {
  clearTimeout(timers.get(t.id));
  t.remaining = ms;
  t.startedAt = Date.now();
  timers.set(t.id, setTimeout(() => close(t.id), ms));
}
function pause(t) {
  clearTimeout(timers.get(t.id));
  t.remaining = Math.max(1500, t.remaining - (Date.now() - t.startedAt));
  t.paused = true;
}
function resume(t) { t.paused = false; arm(t, t.remaining); }
function close(id) { clearTimeout(timers.get(id)); timers.delete(id); store.dismissToast(id); }
function view(t) {
  close(t.id);
  if (t.notification_id) store.markRead(t.notification_id);
  router.push({ path: '/leads', query: { open: t.lead_id } });
}
function onEnter(el) {
  const t = store.toasts.find((x) => String(x.id) === el.dataset.id);
  if (t) arm(t);
}
onBeforeUnmount(() => { for (const id of timers.keys()) clearTimeout(timers.get(id)); });

const typeLabel = (t) => (t === 'quote' ? 'Quote' : 'Inquiry');
</script>

<template>
  <div class="pointer-events-none fixed right-3 top-[4.5rem] z-[70] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-6" aria-live="polite" aria-relevant="additions">
    <TransitionGroup
      enter-from-class="opacity-0 translate-x-6" enter-active-class="transition duration-300 ease-out"
      leave-to-class="opacity-0 translate-x-6" leave-active-class="transition duration-200 ease-in absolute w-full"
      move-class="transition duration-200"
      @after-enter="onEnter"
    >
      <div
        v-for="t in store.toasts" :key="t.id" :data-id="t.id"
        class="toast pointer-events-auto relative overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="status"
        @mouseenter="pause(t)" @mouseleave="resume(t)" @focusin="pause(t)" @focusout="resume(t)"
      >
        <span class="absolute inset-y-0 left-0 w-1" :style="{ background: t.site_color }" />
        <div class="flex gap-3 p-4 pl-5">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl" :style="{ background: t.site_color + '22', color: t.site_color }">
            <AppIcon name="bell" :size="20" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-bold uppercase tracking-wide" :style="{ color: t.site_color }">
              New {{ typeLabel(t.type) }} · <span class="normal-case tracking-normal">{{ t.site_name }}</span>
            </div>
            <div class="mt-0.5 truncate text-sm font-semibold">{{ t.name }}</div>
            <div v-if="t.body" class="truncate text-xs text-muted">{{ t.body }}</div>
            <div class="mt-2.5 flex gap-2">
              <button class="btn btn-primary !px-3 !py-1.5 text-xs" @click="view(t)">View lead</button>
              <button class="btn btn-ghost !px-3 !py-1.5 text-xs" @click="close(t.id)">Dismiss</button>
            </div>
          </div>
          <button class="-mr-1 -mt-1 h-7 w-7 shrink-0 rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close notification" @click="close(t.id)">
            <AppIcon name="close" :size="16" class="mx-auto" />
          </button>
        </div>
        <span
          class="progress absolute bottom-0 left-0 h-0.5"
          :style="{ background: t.site_color, animationDuration: t.duration + 'ms', animationPlayState: t.paused ? 'paused' : 'running' }"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.progress { width: 100%; animation-name: shrink; animation-timing-function: linear; animation-fill-mode: forwards; opacity: .7; }
@keyframes shrink { from { width: 100%; } to { width: 0%; } }
@media (prefers-reduced-motion: reduce) { .progress { animation: none; } }
</style>
