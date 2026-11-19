import { ref, computed } from 'vue';

/**
 * Appearance settings: colour mode (light / dark / system) + accent palette.
 * Stored per browser in localStorage. index.html applies them before first paint (no flash).
 */
export const ACCENTS = [
  { value: 'indigo', label: 'Indigo', desc: 'Calm & professional', from: '#6366f1', to: '#8b5cf6' },
  { value: 'emerald', label: 'Emerald', desc: 'Fresh & balanced', from: '#059669', to: '#0d9488' },
  { value: 'ocean', label: 'Ocean', desc: 'Clear & trustworthy', from: '#0284c7', to: '#2563eb' },
  { value: 'sunset', label: 'Sunset', desc: 'Warm & energetic', from: '#e11d48', to: '#ea580c' },
];
export const MODES = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
const savedMode = store.get('clp-theme');
const mode = ref(['light', 'dark', 'system'].includes(savedMode) ? savedMode : 'system');
const systemLight = ref(!!mql?.matches);
const savedAccent = store.get('clp-accent');
const accent = ref(ACCENTS.some((a) => a.value === savedAccent) ? savedAccent : 'indigo');

/** The theme actually shown: 'light' or 'dark'. */
const theme = computed(() => (mode.value === 'system' ? (systemLight.value ? 'light' : 'dark') : mode.value));

function apply() {
  const el = document.documentElement;
  if (theme.value === 'light') el.dataset.theme = 'light';
  else delete el.dataset.theme;
  if (accent.value === 'indigo') delete el.dataset.accent;
  else el.dataset.accent = accent.value;
}
mql?.addEventListener?.('change', (e) => { systemLight.value = e.matches; apply(); });
apply();

export function useTheme() {
  const setMode = (m) => { mode.value = m; store.set('clp-theme', m); apply(); };
  const setAccent = (a) => { accent.value = a; store.set('clp-accent', a); apply(); };
  const toggle = () => setMode(theme.value === 'dark' ? 'light' : 'dark');
  // Changes whenever anything visual changes; use as a :key to re-render canvas charts.
  const appearanceKey = computed(() => `${theme.value}-${accent.value}`);
  return { theme, mode, accent, setMode, setAccent, toggle, appearanceKey };
}

// Reads a CSS variable so charts follow the active theme.
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** '#6366f1' -> 'rgba(99,102,241,a)' (canvas cannot use CSS color-mix). */
export function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(99,102,241,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
