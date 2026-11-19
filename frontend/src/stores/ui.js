import { defineStore } from 'pinia';
import api from '../api/client';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } };

export const useUiStore = defineStore('ui', {
  state: () => ({
    collapsed: read('clp-sidebar-collapsed', false), // desktop: icon-only sidebar
    mobileOpen: false,
    unread: 0,
  }),
  actions: {
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      write('clp-sidebar-collapsed', this.collapsed);
    },
    async refreshUnread() {
      try { this.unread = (await api.get('/stats/overview')).data.new_unread || 0; } catch { /* keep last value */ }
    },
  },
});
