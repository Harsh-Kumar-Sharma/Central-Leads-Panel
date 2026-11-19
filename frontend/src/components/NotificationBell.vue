<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '../stores/notifications';
import { relativeTime, fullDate } from '../utils/format';
import SiteBadge from './SiteBadge.vue';
import AppIcon from './AppIcon.vue';

const store = useNotificationsStore();
const router = useRouter();
const open = ref(false);
const root = ref(null);
const error = ref('');

const badge = computed(() => (store.unread > 99 ? '99+' : String(store.unread)));
const statusMeta = computed(() => {
  if (store.status === 'live') return { label: 'Live', cls: 'bg-success' };
  if (store.polling) return { label: 'Updating every minute', cls: 'bg-warning' };
  if (store.status === 'reconnecting' || store.status === 'connecting') return { label: 'Reconnecting…', cls: 'bg-warning animate-pulse' };
  return { label: 'Offline', cls: 'bg-muted' };
});

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    error.value = '';
    try { await store.fetchList(); } catch { error.value = 'Could not load notifications'; }
  }
}
async function openItem(n) {
  open.value = false;
  store.markRead(n.id);
  router.push({ path: '/leads', query: { open: n.lead_id } });
}

const onDocDown = (e) => { if (root.value && !root.value.contains(e.target)) open.value = false; };
const onKey = (e) => { if (e.key === 'Escape') open.value = false; };
onMounted(() => { document.addEventListener('mousedown', onDocDown); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); });
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="icon-btn relative grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition hover:text-ink"
      :class="open ? '!text-primary !border-primary/50' : ''"
      :aria-label="store.unread ? `Notifications, ${store.unread} unread` : 'Notifications'"
      aria-haspopup="dialog" :aria-expanded="open" title="Notifications"
      @click="toggle"
    >
      <AppIcon name="bell" :size="19" :class="store.unread ? 'bell-ring' : ''" />
      <span
        v-if="store.unread"
        class="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--bg)] tabular-nums"
      >{{ badge }}</span>
    </button>

    <Transition enter-from-class="opacity-0 -translate-y-1 scale-95" leave-to-class="opacity-0 -translate-y-1 scale-95" enter-active-class="transition duration-150 ease-out" leave-active-class="transition duration-100 ease-in">
      <div
        v-if="open"
        class="absolute right-0 mt-2 flex max-h-[70vh] w-[24rem] origin-top-right flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:w-auto"
        role="dialog" aria-label="Notifications"
      >
        <div class="flex items-center gap-2 border-b border-line px-4 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-sm font-semibold">
              Notifications
              <span v-if="store.unread" class="rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-bold text-danger">{{ store.unread }} new</span>
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span class="h-1.5 w-1.5 rounded-full" :class="statusMeta.cls" /> {{ statusMeta.label }}
            </div>
          </div>
          <button
            v-if="store.unread"
            class="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-surface-2"
            @click="store.markAllRead()"
          >Mark all as read</button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div v-if="store.loading && !store.items.length" class="space-y-2 p-3">
            <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-xl bg-surface-2" />
          </div>
          <div v-else-if="error" class="p-6 text-center text-sm text-danger">{{ error }}</div>
          <div v-else-if="!store.items.length" class="px-6 py-12 text-center">
            <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><AppIcon name="bell" :size="22" /></div>
            <div class="text-sm font-semibold">No notifications</div>
            <div class="mt-1 text-xs text-muted">New leads from your companies will appear here.</div>
          </div>
          <ul v-else class="divide-y divide-line">
            <li v-for="n in store.items" :key="n.id">
              <button
                class="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                :class="n.is_read ? '' : 'bg-primary/[0.04]'"
                @click="openItem(n)"
              >
                <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :class="n.is_read ? 'bg-transparent' : 'bg-primary'" />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <SiteBadge :name="n.site_name" :color="n.site_color" />
                    <span class="ml-auto shrink-0 text-[11px] text-muted" :title="fullDate(n.created_at)">{{ relativeTime(n.created_at) }}</span>
                  </span>
                  <span class="mt-1.5 block truncate text-sm" :class="n.is_read ? 'text-ink/80' : 'font-semibold'">{{ n.title }}</span>
                  <span v-if="n.body" class="mt-0.5 block truncate text-xs text-muted">{{ n.body }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <RouterLink to="/account#notifications" class="flex items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink" @click="open = false">
          <AppIcon name="settings" :size="14" /> Notification settings
        </RouterLink>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.icon-btn { background: var(--surface); }
.icon-btn:hover { background: var(--surface-2); }
.bell-ring { transform-origin: 50% 10%; animation: ring 2.4s ease-in-out 1; }
@keyframes ring {
  0%, 60%, 100% { transform: rotate(0); }
  10% { transform: rotate(14deg); } 20% { transform: rotate(-12deg); }
  30% { transform: rotate(9deg); } 40% { transform: rotate(-6deg); } 50% { transform: rotate(3deg); }
}
@media (prefers-reduced-motion: reduce) { .bell-ring { animation: none; } }
</style>
