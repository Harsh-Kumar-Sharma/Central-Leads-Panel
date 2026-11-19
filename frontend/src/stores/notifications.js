import { defineStore } from 'pinia';
import api, { tokenStore } from '../api/client';
import { createSSE } from '../utils/sseClient';
import { playChime } from '../utils/sound';

const SOUND_KEY = 'clp-notify-sound';
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; } };
const POLL_MS = 60000;
const TOAST_MS = 8000;

let sse = null;
let pollTimer = null;
let toastSeq = 0;

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [],
    unread: 0,
    loaded: false,
    loading: false,
    status: 'off', // off | connecting | live | reconnecting
    polling: false,
    toasts: [],
    sound: readSound(),
    lastEvent: null, // { lead_id, site_id, at } — pages can react (e.g. refresh the leads list)
  }),

  actions: {
    // ------------------------------------------------ REST
    async fetchList() {
      this.loading = true;
      try {
        const { data } = await api.get('/notifications', { params: { limit: 20 } });
        this.items = data.data;
        this.unread = data.unread_count;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    async fetchCount() {
      try { this.unread = (await api.get('/notifications/unread-count')).data.unread_count; } catch { /* keep last */ }
    },
    async markRead(id) {
      const n = this.items.find((x) => x.id === id);
      if (n && !n.is_read) { n.is_read = true; this.unread = Math.max(0, this.unread - 1); }
      try {
        const { data } = await api.post(`/notifications/${id}/read`);
        this.unread = data.unread_count;
      } catch { /* optimistic; next refresh corrects it */ }
    },
    async markAllRead() {
      this.items.forEach((n) => { n.is_read = true; });
      this.unread = 0;
      await api.post('/notifications/read-all');
    },

    // ------------------------------------------------ live connection
    connect() {
      if (sse) return;
      this.fetchCount();
      sse = createSSE({
        url: `${import.meta.env.VITE_API_BASE || '/api'}/notifications/stream`,
        getToken: () => tokenStore.get(),
        onStatus: (s) => { this.status = s; },
        onFallback: (on) => (on ? this.startPolling() : this.stopPolling()),
        onUnauthorized: () => { this.disconnect(); window.dispatchEvent(new CustomEvent('clp:unauthorized')); },
        onEvent: (event, data) => this.handleEvent(event, data),
      });
      sse.start();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
    },
    disconnect() {
      if (sse) sse.stop();
      sse = null;
      this.stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      this.$reset();
    },
    /** Re-open the stream with the current token (e.g. after a password change rotated it). */
    reconnect() {
      if (sse) sse.nudge();
    },
    startPolling() {
      if (pollTimer) return;
      this.polling = true;
      this.fetchCount();
      pollTimer = setInterval(() => this.fetchCount(), POLL_MS);
    },
    stopPolling() {
      clearInterval(pollTimer);
      pollTimer = null;
      this.polling = false;
    },

    handleEvent(event, data) {
      if (event === 'ready' && data) {
        this.unread = data.unread_count;
        return;
      }
      if (event !== 'new_lead' || !data) return;
      this.unread += 1;
      if (this.loaded) {
        this.items.unshift({
          id: data.notification_id, lead_id: data.lead_id, site_id: data.site_id, site_name: data.site_name,
          site_color: data.site_color, type: data.type, name: data.name, title: data.title, body: data.body,
          is_read: false, created_at: data.created_at,
        });
        this.items = this.items.slice(0, 20);
      }
      this.lastEvent = { lead_id: data.lead_id, site_id: data.site_id, at: Date.now() };
      this.pushToast(data);
      if (this.sound) playChime();
    },

    // ------------------------------------------------ toasts
    pushToast(data) {
      const id = ++toastSeq;
      this.toasts.push({ id, ...data, duration: TOAST_MS });
      if (this.toasts.length > 4) this.toasts.shift();
    },
    dismissToast(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    setSound(on) {
      this.sound = on;
      try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* ignore */ }
      if (on) playChime();
    },
  },
});

// Reconnect promptly when the tab comes back or the network returns.
// A healthy stream is left alone; only a broken/reconnecting one is retried right away.
function onVisible() {
  if (document.visibilityState !== 'visible' || !sse) return;
  const store = useNotificationsStore();
  if (store.status !== 'live') { sse.nudge(); store.fetchCount(); }
}
function onOnline() {
  if (sse && useNotificationsStore().status !== 'live') sse.nudge();
}
