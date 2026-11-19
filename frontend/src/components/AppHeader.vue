<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { useTheme } from '../utils/theme';
import AppIcon from './AppIcon.vue';
import AppearanceMenu from './AppearanceMenu.vue';

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();
const { theme, toggle: toggleTheme } = useTheme();

const crumbs = computed(() => route.meta.crumbs || [route.meta.title]);
const initials = computed(() => (auth.user?.name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const roleLabel = computed(() => ({ super_admin: 'Super Admin', manager: 'Manager', viewer: 'Viewer' })[auth.user?.role] || '');

// ---- Quick search: Enter jumps to Leads filtered by the query; Ctrl/⌘+K focuses it ----
const searchEl = ref(null);
const query = ref('');
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
function submitSearch() {
  const q = query.value.trim().slice(0, 100);
  router.push({ path: '/leads', query: q ? { q } : {} });
  searchEl.value?.blur();
}
watch(() => route.query.q, (q) => { if (route.path === '/leads') query.value = typeof q === 'string' ? q : ''; }, { immediate: true });

// ---- User menu ----
const menuOpen = ref(false);
const menuRoot = ref(null);
function onDocDown(e) { if (menuRoot.value && !menuRoot.value.contains(e.target)) menuOpen.value = false; }
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchEl.value?.focus(); searchEl.value?.select(); }
  if (e.key === 'Escape') menuOpen.value = false;
}
onMounted(() => { document.addEventListener('mousedown', onDocDown); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); });
watch(() => route.fullPath, () => { menuOpen.value = false; });

function logout() {
  menuOpen.value = false;
  auth.logout();
  router.replace({ name: 'login' });
}
</script>

<template>
  <header class="header sticky top-0 z-30 border-b border-line">
    <div class="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
      <button class="btn-ghost -ml-1 rounded-lg p-2 lg:hidden" aria-label="Open menu" @click="ui.mobileOpen = true">
        <AppIcon name="menu" />
      </button>

      <!-- Breadcrumb + title -->
      <div class="min-w-0 flex-1">
        <nav v-if="crumbs.length > 1" class="hidden items-center gap-1 text-[11px] font-medium text-muted sm:flex" aria-label="Breadcrumb">
          <template v-for="(c, i) in crumbs" :key="i">
            <span :class="i === crumbs.length - 1 ? 'text-ink/70' : ''">{{ c }}</span>
            <AppIcon v-if="i < crumbs.length - 1" name="chevronRight" :size="12" />
          </template>
        </nav>
        <h1 class="truncate text-[17px] font-bold leading-tight tracking-tight">{{ route.meta.title }}</h1>
        <p v-if="route.meta.subtitle" class="hidden truncate text-xs text-muted md:block">{{ route.meta.subtitle }}</p>
      </div>

      <!-- Search -->
      <form class="relative hidden w-72 md:block lg:w-80" role="search" @submit.prevent="submitSearch">
        <AppIcon name="search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref="searchEl" v-model="query" type="search" maxlength="100" placeholder="Search leads…"
          aria-label="Search leads"
          class="h-10 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-16 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-[var(--ring)]"
        />
        <kbd class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
      </form>
      <RouterLink to="/leads" class="btn-ghost rounded-xl p-2.5 md:hidden" aria-label="Search leads"><AppIcon name="search" :size="20" /></RouterLink>

      <!-- Appearance: colour mode + accent palette -->
      <AppearanceMenu />

      <!-- User menu -->
      <div ref="menuRoot" class="relative">
        <button
          class="flex items-center gap-2.5 rounded-xl border border-transparent py-1 pl-1 pr-2 transition hover:border-line hover:bg-surface-2"
          :aria-expanded="menuOpen" aria-haspopup="menu" aria-label="Account menu"
          @click="menuOpen = !menuOpen"
        >
          <span class="avatar grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold text-white">{{ initials }}</span>
          <span class="hidden text-left leading-tight sm:block">
            <span class="block max-w-[9rem] truncate text-sm font-semibold">{{ auth.user?.name }}</span>
            <span class="block text-[11px] text-muted">{{ roleLabel }}</span>
          </span>
          <AppIcon name="chevronDown" :size="16" class="hidden text-muted transition-transform sm:block" :class="menuOpen ? 'rotate-180' : ''" />
        </button>

        <Transition enter-from-class="opacity-0 -translate-y-1 scale-95" leave-to-class="opacity-0 -translate-y-1 scale-95" enter-active-class="transition duration-150 ease-out" leave-active-class="transition duration-100 ease-in">
          <div v-if="menuOpen" class="absolute right-0 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" role="menu">
            <div class="flex items-center gap-3 border-b border-line p-4">
              <span class="avatar grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white">{{ initials }}</span>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold">{{ auth.user?.name }}</div>
                <div class="truncate text-xs text-muted">{{ auth.user?.email }}</div>
              </div>
            </div>
            <div class="p-1.5">
              <RouterLink to="/account" class="menu-item" role="menuitem"><AppIcon name="account" :size="18" /> My account</RouterLink>
              <button class="menu-item w-full" role="menuitem" @click="toggleTheme">
                <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
                {{ theme === 'dark' ? 'Light theme' : 'Dark theme' }}
              </button>
              <div class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted">
                <AppIcon name="shield" :size="14" class="text-success" /> Role: <b class="text-ink/80">{{ roleLabel }}</b>
              </div>
            </div>
            <div class="border-t border-line p-1.5">
              <button class="menu-item w-full text-danger hover:!bg-danger/10" role="menuitem" @click="logout"><AppIcon name="logout" :size="18" /> Sign out</button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: saturate(160%) blur(12px);
  -webkit-backdrop-filter: saturate(160%) blur(12px);
}
.icon-btn { background: var(--surface); }
.icon-btn:hover { background: var(--surface-2); }
.avatar { background: linear-gradient(135deg, #06b6d4, var(--primary)); }
.menu-item {
  display: flex; align-items: center; gap: .65rem;
  padding: .55rem .75rem; border-radius: .6rem;
  font-size: .875rem; font-weight: 500; text-align: left;
  color: var(--text); transition: background .12s;
}
.menu-item:hover { background: var(--surface-2); }
</style>
