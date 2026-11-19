<script setup>
import { ref, computed, onMounted } from 'vue';
import api, { errorMessage } from '../api/client';
import { useNotificationsStore } from '../stores/notifications';
import Toggle from './Toggle.vue';
import MultiSelect from './MultiSelect.vue';
import AppIcon from './AppIcon.vue';

const store = useNotificationsStore();
const sites = ref([]);
const bell = ref(true);
const mode = ref('all'); // all | selected
const selected = ref([]);
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref('');
let initial = '';

const snapshot = () => JSON.stringify({ bell: bell.value, mode: mode.value, selected: [...selected.value].sort() });
const dirty = computed(() => !loading.value && snapshot() !== initial);
const siteOptions = computed(() => sites.value.map((s) => ({ value: s.id, label: s.name, color: s.color })));

onMounted(async () => {
  try {
    const [p, s] = await Promise.all([api.get('/notifications/prefs'), api.get('/sites')]);
    sites.value = s.data;
    bell.value = p.data.bell_enabled;
    mode.value = Array.isArray(p.data.site_ids) ? 'selected' : 'all';
    selected.value = Array.isArray(p.data.site_ids) ? p.data.site_ids.filter((id) => s.data.some((x) => x.id === id)) : [];
    initial = snapshot();
  } catch (e) {
    error.value = errorMessage(e, 'Could not load notification settings');
  } finally {
    loading.value = false;
  }
});

async function save() {
  error.value = '';
  saved.value = false;
  if (bell.value && mode.value === 'selected' && !selected.value.length) {
    error.value = 'Choose at least one company, or select "All my companies".';
    return;
  }
  saving.value = true;
  try {
    await api.put('/notifications/prefs', { bell_enabled: bell.value, site_ids: mode.value === 'all' ? null : selected.value });
    initial = snapshot();
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = e?.response?.data?.errors?.site_ids || errorMessage(e, 'Could not save settings');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section id="notifications" class="card scroll-mt-24 p-5">
    <div class="flex items-start gap-3">
      <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><AppIcon name="bell" :size="20" /></div>
      <div>
        <h2 class="font-semibold">Notifications</h2>
        <p class="text-xs text-muted">Choose how you hear about new leads. Applies to new leads from now on.</p>
      </div>
    </div>

    <div v-if="loading" class="mt-5 space-y-3"><div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-xl bg-surface-2" /></div>

    <div v-else class="mt-5 space-y-5">
      <div class="flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div class="text-sm font-semibold">Show bell notifications</div>
          <div class="text-xs text-muted">Bell count and pop-ups when a new lead arrives.</div>
        </div>
        <Toggle v-model="bell" :label="bell ? 'On' : 'Off'" />
      </div>

      <div class="rounded-xl border border-line p-4" :class="bell ? '' : 'pointer-events-none opacity-50'" :aria-disabled="!bell">
        <div class="text-sm font-semibold">Notify me for</div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Notify me for">
          <label class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm" :class="mode === 'all' ? 'border-primary bg-primary/[0.06]' : 'border-line'">
            <input v-model="mode" type="radio" value="all" class="accent-[var(--primary)]" /> All my companies
          </label>
          <label class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm" :class="mode === 'selected' ? 'border-primary bg-primary/[0.06]' : 'border-line'">
            <input v-model="mode" type="radio" value="selected" class="accent-[var(--primary)]" /> Only selected companies
          </label>
        </div>
        <div v-if="mode === 'selected'" class="mt-3">
          <MultiSelect v-model="selected" label="Companies to notify me about" :options="siteOptions" placeholder="Choose companies…" />
          <p class="mt-1.5 text-xs text-muted">Only companies you have access to are listed.</p>
        </div>
      </div>

      <div class="flex items-start justify-between gap-4 rounded-xl border border-line p-4">
        <div>
          <div class="text-sm font-semibold">Play a sound</div>
          <div class="text-xs text-muted">A soft chime with each pop-up. Saved on this device.</div>
        </div>
        <Toggle :model-value="store.sound" :label="store.sound ? 'On' : 'Off'" @update:model-value="store.setSound" />
      </div>

      <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ error }}</div>
      <div class="flex items-center justify-end gap-3">
        <span v-if="saved" class="flex items-center gap-1 text-sm text-success"><AppIcon name="check" :size="16" /> Saved</span>
        <button class="btn btn-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : 'Save notification settings' }}</button>
      </div>
    </div>
  </section>
</template>
