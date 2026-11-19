<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import AppIcon from './AppIcon.vue';

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();

const sections = computed(() => {
  const s = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Dashboard', icon: 'dashboard' },
        { to: '/leads', label: 'Leads', icon: 'leads', badge: ui.unread },
      ],
    },
  ];
  if (auth.isSuperAdmin) {
    s.push({
      title: 'Administration',
      items: [
        { to: '/admin/sites', label: 'Sites & API keys', icon: 'globe' },
        { to: '/admin/users', label: 'Users & access', icon: 'users' },
        { to: '/admin/notifications', label: 'Notifications', icon: 'bell' },
      ],
    });
  }
  s.push({ title: 'Account', items: [{ to: '/account', label: 'My account', icon: 'account' }] });
  return s;
});

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
const initials = computed(() => (auth.user?.name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const roleLabel = computed(() => ({ super_admin: 'Super Admin', manager: 'Manager', viewer: 'Viewer' })[auth.user?.role] || '');
const badgeText = (n) => (n > 99 ? '99+' : String(n));
// On mobile the drawer is always full width, so "collapsed" only applies on desktop.
const mini = computed(() => ui.collapsed && !ui.mobileOpen);
</script>

<template>
  <aside
    class="sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line transition-[width,transform] duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0"
    :class="[ui.mobileOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72', mini ? 'lg:w-[76px]' : 'lg:w-64']"
    aria-label="Main navigation"
  >
    <!-- Brand -->
    <div class="flex h-16 shrink-0 items-center gap-3 px-4" :class="mini ? 'lg:justify-center lg:px-0' : ''">
      <RouterLink to="/" class="flex min-w-0 items-center gap-3" aria-label="Central Leads home">
        <div class="logo grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V7l8 6 8-6v11" /></svg>
        </div>
        <div v-show="!mini" class="min-w-0 leading-tight">
          <div class="truncate text-[15px] font-bold tracking-tight">Central Leads</div>
          <div class="truncate text-[11px] font-medium text-muted">Lead management console</div>
        </div>
      </RouterLink>
      <button class="btn-ghost ml-auto rounded-lg p-1.5 lg:hidden" aria-label="Close menu" @click="ui.mobileOpen = false">
        <AppIcon name="close" />
      </button>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 pb-4 pt-2" :class="mini ? 'overflow-y-auto overflow-x-hidden lg:overflow-visible' : 'overflow-y-auto overflow-x-hidden'">
      <div v-for="(sec, i) in sections" :key="sec.title" :class="i ? 'mt-6' : ''">
        <div v-if="!mini" class="mb-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted/70">{{ sec.title }}</div>
        <div v-else class="mx-auto mb-2 hidden h-px w-8 bg-line lg:block" />
        <ul class="space-y-1">
          <li v-for="item in sec.items" :key="item.to">
            <RouterLink
              :to="item.to"
              class="nav-item group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
              :class="[isActive(item.to) ? 'nav-active' : 'text-muted hover:bg-surface-2 hover:text-ink', mini ? 'lg:justify-center lg:px-0' : '']"
              :aria-current="isActive(item.to) ? 'page' : undefined"
              :aria-label="mini ? item.label : undefined"
            >
              <span v-if="isActive(item.to)" class="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              <span class="relative shrink-0">
                <AppIcon :name="item.icon" :size="20" />
                <span v-if="mini && item.badge" class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-[var(--surface)]" />
              </span>
              <span v-show="!mini" class="flex-1 truncate">{{ item.label }}</span>
              <span v-if="!mini && item.badge" class="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-warning" :title="`${item.badge} new & unread`">{{ badgeText(item.badge) }}</span>
              <!-- Tooltip in collapsed mode -->
              <span v-if="mini" class="tooltip pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 lg:block">
                {{ item.label }}<template v-if="item.badge"> · {{ badgeText(item.badge) }} new</template>
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <!-- User card -->
    <div class="shrink-0 border-t border-line p-3">
      <RouterLink
        to="/account"
        class="group relative flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-2"
        :class="mini ? 'lg:justify-center' : ''"
      >
        <div class="avatar grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white">{{ initials }}</div>
        <div v-show="!mini" class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">{{ auth.user?.name }}</div>
          <div class="flex items-center gap-1.5 text-[11px] text-muted">
            <span class="h-1.5 w-1.5 rounded-full bg-success" /> {{ roleLabel }}
          </div>
        </div>
        <AppIcon v-show="!mini" name="chevronRight" :size="16" class="text-muted transition-transform group-hover:translate-x-0.5" />
      </RouterLink>
      <button
        class="mt-2 hidden w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:flex"
        :class="mini ? 'justify-center px-0' : ''"
        :aria-label="mini ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="mini ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="ui.toggleCollapsed()"
      >
        <AppIcon :name="mini ? 'chevronRight' : 'chevronLeft'" :size="18" />
        <span v-show="!mini">Collapse</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  background:
    radial-gradient(120% 60% at 0% 0%, color-mix(in srgb, var(--primary) 9%, transparent), transparent 60%),
    var(--surface);
}
.logo {
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  box-shadow: 0 8px 20px -8px var(--ring), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.avatar { background: linear-gradient(135deg, #06b6d4, var(--primary)); }
.nav-active {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
.tooltip { background: var(--text); color: var(--bg); }
</style>
