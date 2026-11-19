import { defineStore } from 'pinia';
import api, { tokenStore } from '../api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, token: tokenStore.get(), loaded: false }),
  getters: {
    isAuthenticated: (s) => !!s.token && !!s.user,
    isSuperAdmin: (s) => s.user?.role === 'super_admin',
    canEdit: (s) => ['super_admin', 'manager'].includes(s.user?.role),
  },
  actions: {
    async login(email, password) {
      const { data } = await api.post('/auth/login', { email, password });
      this.token = data.token;
      tokenStore.set(data.token);
      await this.fetchMe();
    },
    async fetchMe() {
      if (!this.token) { this.loaded = true; return; }
      try {
        const { data } = await api.get('/auth/me');
        this.user = data.user;
      } catch (e) {
        // Only a real auth failure ends the session; a server restart/network blip should not.
        if (e?.response?.status === 401 || e?.response?.status === 403) this.logout();
      } finally {
        this.loaded = true;
      }
    },
    /** User-initiated sign out: revoke this token on the server, then clear it locally. */
    async signOut() {
      const token = this.token;
      this.logout();
      if (token) {
        try { await api.post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }); } catch { /* already invalid / offline */ }
      }
    },
    logout() {
      this.user = null;
      this.token = null;
      tokenStore.clear();
    },
  },
});
