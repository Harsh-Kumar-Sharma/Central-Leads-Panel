<script setup>
import { ref, computed, watch } from 'vue';
import { errorMessage } from '../../api/client';
import Toggle from '../Toggle.vue';
import AppIcon from '../AppIcon.vue';

/** Editable list of email recipients with To/CC/BCC (and optional active toggle). */
const props = defineProps({
  items: { type: Array, default: () => [] },
  withActive: { type: Boolean, default: false },
  onSave: { type: Function, required: true },
  help: String,
});

const rows = ref([]);
const newEmail = ref('');
const newMode = ref('to');
const addError = ref('');
const errors = ref({});
const formError = ref('');
const saving = ref(false);
const saved = ref(false);
let initial = '';

const clone = (list) => list.map((r) => ({ email: r.email, mode: r.mode || 'to', is_active: r.is_active !== false }));
watch(() => props.items, (list) => { rows.value = clone(list); initial = JSON.stringify(rows.value); errors.value = {}; }, { immediate: true, deep: true });
const dirty = computed(() => JSON.stringify(rows.value) !== initial);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function add() {
  addError.value = '';
  const email = newEmail.value.trim().toLowerCase();
  if (!isEmail(email)) { addError.value = 'Enter a valid email address'; return; }
  if (rows.value.some((r) => r.email === email)) { addError.value = 'Already in the list'; return; }
  if (rows.value.length >= 50) { addError.value = 'At most 50 recipients'; return; }
  rows.value.push({ email, mode: newMode.value, is_active: true });
  newEmail.value = '';
}
const remove = (i) => rows.value.splice(i, 1);

async function save() {
  saving.value = true; saved.value = false; errors.value = {}; formError.value = '';
  try {
    const payload = rows.value.map((r) => (props.withActive ? r : { email: r.email, mode: r.mode }));
    await props.onSave(payload);
    initial = JSON.stringify(rows.value);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    const errs = e?.response?.data?.errors;
    if (errs) errors.value = Object.fromEntries(Object.entries(errs).map(([k, v]) => [k.split('.')[0], v]));
    formError.value = errs ? Object.values(errs).join(' · ') : errorMessage(e, 'Could not save recipients');
  } finally { saving.value = false; }
}

const MODES = [{ v: 'to', l: 'To' }, { v: 'cc', l: 'CC' }, { v: 'bcc', l: 'BCC' }];
</script>

<template>
  <div class="space-y-4">
    <p v-if="help" class="text-sm text-muted">{{ help }}</p>

    <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="add">
      <input v-model="newEmail" class="input" type="email" placeholder="name@company.com" aria-label="Recipient email" maxlength="200" />
      <div class="flex gap-2">
        <select v-model="newMode" class="input !w-24" aria-label="Recipient type">
          <option v-for="m in MODES" :key="m.v" :value="m.v">{{ m.l }}</option>
        </select>
        <button class="btn btn-ghost shrink-0 border border-line">+ Add</button>
      </div>
    </form>
    <p v-if="addError" class="-mt-2 text-xs text-danger">{{ addError }}</p>

    <div class="overflow-hidden rounded-xl border border-line">
      <div v-if="!rows.length" class="px-4 py-8 text-center text-sm text-muted">No recipients yet.</div>
      <ul v-else class="divide-y divide-line">
        <li v-for="(r, i) in rows" :key="r.email" class="flex flex-wrap items-center gap-3 px-4 py-2.5" :class="withActive && !r.is_active ? 'opacity-60' : ''">
          <AppIcon name="mail" :size="16" class="shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate text-sm" :class="errors[i] ? 'text-danger' : ''">{{ r.email }}</span>
          <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs" role="radiogroup" :aria-label="`Type for ${r.email}`">
            <button
              v-for="m in MODES" :key="m.v" type="button" role="radio" :aria-checked="r.mode === m.v"
              class="rounded-md px-2.5 py-1 font-semibold" :class="r.mode === m.v ? 'bg-primary text-white' : 'text-muted hover:text-ink'"
              @click="r.mode = m.v"
            >{{ m.l }}</button>
          </div>
          <Toggle v-if="withActive" v-model="r.is_active" :label="r.is_active ? 'Active' : 'Paused'" />
          <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger" :aria-label="`Remove ${r.email}`" @click="remove(i)">
            <AppIcon name="close" :size="16" />
          </button>
        </li>
      </ul>
    </div>

    <div v-if="formError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ formError }}</div>
    <div class="flex items-center justify-end gap-3">
      <span v-if="saved" class="flex items-center gap-1 text-sm text-success"><AppIcon name="check" :size="16" /> Saved</span>
      <span v-else-if="dirty" class="text-xs text-muted">Unsaved changes</span>
      <button class="btn btn-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : 'Save recipients' }}</button>
    </div>
  </div>
</template>
