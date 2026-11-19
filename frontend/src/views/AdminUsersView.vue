<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import api, { errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { relativeTime, fullDate } from '../utils/format';
import SiteBadge from '../components/SiteBadge.vue';
import Chip from '../components/Chip.vue';
import Modal from '../components/Modal.vue';
import Toggle from '../components/Toggle.vue';
import MultiSelect from '../components/MultiSelect.vue';

const auth = useAuthStore();
const users = ref([]);
const sites = ref([]);
const loading = ref(true);
const error = ref('');

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: '#8b5cf6', help: 'Everything: all sites, sites & keys, users.' },
  { value: 'manager', label: 'Manager', color: '#06b6d4', help: 'Assigned sites only. Can change status, add notes, export.' },
  { value: 'viewer', label: 'Viewer', color: '#64748b', help: 'Assigned sites only. Read-only, can export.' },
];
const roleMeta = (r) => ROLES.find((x) => x.value === r) || ROLES[2];

const editing = ref(null);
const form = reactive({ name: '', email: '', password: '', role: 'viewer', is_active: true, site_ids: [] });
const fieldErrors = ref({});
const formError = ref('');
const saving = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [u, s] = await Promise.all([api.get('/admin/users'), api.get('/admin/sites')]);
    users.value = u.data;
    sites.value = s.data;
  } catch (e) {
    error.value = errorMessage(e, 'Could not load users');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const siteById = computed(() => new Map(sites.value.map((s) => [s.id, s])));
const siteOptions = computed(() => sites.value.map((s) => ({ value: s.id, label: s.name, color: s.color })));
const isNew = computed(() => editing.value && !editing.value.id);
const isSelf = computed(() => editing.value?.id === auth.user?.id);

function open(u) {
  editing.value = u || {};
  Object.assign(form, u
    ? { name: u.name, email: u.email, password: '', role: u.role, is_active: u.is_active, site_ids: [...u.site_ids] }
    : { name: '', email: '', password: '', role: 'viewer', is_active: true, site_ids: [] });
  fieldErrors.value = {};
  formError.value = '';
}
const close = () => { editing.value = null; };

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  form.password = Array.from(arr, (n) => chars[n % chars.length]).join('');
}

async function save() {
  saving.value = true;
  fieldErrors.value = {};
  formError.value = '';
  const body = {
    name: form.name, email: form.email, role: form.role, is_active: form.is_active,
    site_ids: form.role === 'super_admin' ? [] : form.site_ids,
  };
  if (isNew.value || form.password) body.password = form.password;
  try {
    const { data } = isNew.value ? await api.post('/admin/users', body) : await api.put(`/admin/users/${editing.value.id}`, body);
    const i = users.value.findIndex((u) => u.id === data.id);
    if (i >= 0) users.value[i] = data; else users.value.push(data);
    users.value.sort((a, b) => a.name.localeCompare(b.name));
    if (data.id === auth.user?.id) auth.fetchMe();
    close();
  } catch (e) {
    const errs = e?.response?.data?.errors;
    fieldErrors.value = errs ? Object.fromEntries(Object.entries(errs).map(([k, v]) => [k.split('.')[0], v])) : {};
    const shown = ['name', 'email', 'password', 'site_ids'].some((k) => fieldErrors.value[k]);
    formError.value = shown ? '' : errorMessage(e, 'Could not save user');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">Managers and viewers only see leads of the sites assigned to them.</p>
      <button class="btn btn-primary" @click="open(null)">+ Add user</button>
    </div>

    <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ error }}</div>

    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-sm">
          <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr><th class="px-4 py-3">User</th><th class="px-4 py-3">Role</th><th class="px-4 py-3">Sites</th><th class="px-4 py-3">Last login</th><th class="px-4 py-3">Status</th><th class="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="6" class="px-4 py-10 text-center text-muted">Loading…</td></tr>
            <tr v-for="u in users" :key="u.id" class="border-t border-line hover:bg-surface-2">
              <td class="px-4 py-3">
                <div class="font-medium">{{ u.name }} <span v-if="u.id === auth.user?.id" class="text-xs text-muted">(you)</span></div>
                <div class="text-xs text-muted">{{ u.email }}</div>
              </td>
              <td class="px-4 py-3"><Chip :label="roleMeta(u.role).label" :color="roleMeta(u.role).color" /></td>
              <td class="px-4 py-3">
                <span v-if="u.role === 'super_admin'" class="text-xs text-muted">All sites</span>
                <div v-else class="flex flex-wrap gap-1">
                  <SiteBadge v-for="sid in u.site_ids" :key="sid" :name="siteById.get(sid)?.name || '#' + sid" :color="siteById.get(sid)?.color || '#64748b'" />
                  <span v-if="!u.site_ids.length" class="text-xs text-warning">No sites assigned</span>
                </div>
              </td>
              <td class="px-4 py-3 text-muted" :title="fullDate(u.last_login_at)">{{ u.last_login_at ? relativeTime(u.last_login_at) : 'Never' }}</td>
              <td class="px-4 py-3"><Chip :label="u.is_active ? 'Active' : 'Inactive'" :color="u.is_active ? '#10b981' : '#64748b'" /></td>
              <td class="px-4 py-3 text-right"><button class="btn btn-ghost border border-line !py-1.5" @click="open(u)">Edit</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-if="editing" :title="isNew ? 'Add user' : `Edit ${editing.name}`" @close="close">
      <form id="user-form" class="space-y-4" novalidate @submit.prevent="save">
        <div v-if="formError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ formError }}</div>
        <div>
          <label class="label" for="u-name">Name</label>
          <input id="u-name" v-model="form.name" class="input" maxlength="150" />
          <p v-if="fieldErrors.name" class="mt-1 text-xs text-danger">{{ fieldErrors.name }}</p>
        </div>
        <div>
          <label class="label" for="u-email">Email</label>
          <input id="u-email" v-model="form.email" class="input" type="email" maxlength="200" autocomplete="off" />
          <p v-if="fieldErrors.email" class="mt-1 text-xs text-danger">{{ fieldErrors.email }}</p>
        </div>
        <div>
          <div class="flex items-center justify-between">
            <label class="label" for="u-pass">{{ isNew ? 'Password' : 'New password (leave blank to keep)' }}</label>
            <button type="button" class="text-xs font-semibold text-primary hover:underline" @click="generatePassword">Generate</button>
          </div>
          <input id="u-pass" v-model="form.password" class="input font-mono" type="text" minlength="8" maxlength="200" autocomplete="new-password" spellcheck="false" />
          <p class="mt-1 text-xs text-muted">At least 8 characters. Changing it signs the user out everywhere.</p>
          <p v-if="fieldErrors.password" class="mt-1 text-xs text-danger">{{ fieldErrors.password }}</p>
        </div>
        <div>
          <label class="label" for="u-role">Role</label>
          <select id="u-role" v-model="form.role" class="input" :disabled="isSelf">
            <option v-for="r in ROLES" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <p class="mt-1 text-xs text-muted">{{ roleMeta(form.role).help }}</p>
        </div>
        <div v-if="form.role !== 'super_admin'">
          <span class="label">Assigned sites</span>
          <MultiSelect v-model="form.site_ids" label="Assigned sites" :options="siteOptions" placeholder="No sites (sees nothing)" />
          <p v-if="fieldErrors.site_ids" class="mt-1 text-xs text-danger">{{ fieldErrors.site_ids }}</p>
        </div>
        <Toggle v-model="form.is_active" label="Active (can log in)" :disabled="isSelf" />
      </form>
      <template #footer>
        <button class="btn btn-ghost" @click="close">Cancel</button>
        <button class="btn btn-primary" form="user-form" :disabled="saving">{{ saving ? 'Saving…' : isNew ? 'Create user' : 'Save changes' }}</button>
      </template>
    </Modal>
  </div>
</template>
