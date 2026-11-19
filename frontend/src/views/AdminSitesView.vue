<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import api, { errorMessage } from '../api/client';
import { snippets } from '../utils/snippets';
import SiteBadge from '../components/SiteBadge.vue';
import Chip from '../components/Chip.vue';
import Modal from '../components/Modal.vue';
import Toggle from '../components/Toggle.vue';

const sites = ref([]);
const loading = ref(true);
const error = ref('');

const editing = ref(null); // site object being edited, or {} for new
const form = reactive({ name: '', domain: '', color: '#3B82F6', origins: '', is_active: true });
const fieldErrors = ref({});
const formError = ref('');
const saving = ref(false);
const regenerating = ref(false);
const confirmRegen = ref(false);
const showKey = ref(false);
const copied = ref('');
const snippetTab = ref('html');

async function load() {
  loading.value = true;
  error.value = '';
  try { sites.value = (await api.get('/admin/sites')).data; }
  catch (e) { error.value = errorMessage(e, 'Could not load sites'); }
  finally { loading.value = false; }
}
onMounted(load);

function open(site) {
  editing.value = site || {};
  Object.assign(form, site
    ? { name: site.name, domain: site.domain, color: site.color, origins: site.allowed_origins.join('\n'), is_active: site.is_active }
    : { name: '', domain: '', color: '#3B82F6', origins: '', is_active: true });
  fieldErrors.value = {};
  formError.value = '';
  confirmRegen.value = false;
  showKey.value = false;
  snippetTab.value = 'html';
}
const close = () => { editing.value = null; };
const isNew = computed(() => editing.value && !editing.value.id);

function suggestOrigins() {
  const d = form.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (d) form.origins = `https://${d}\nhttps://www.${d}`;
}

async function save() {
  saving.value = true;
  fieldErrors.value = {};
  formError.value = '';
  const body = {
    name: form.name, domain: form.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), color: form.color,
    allowed_origins: form.origins.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean), is_active: form.is_active,
  };
  try {
    const { data } = isNew.value ? await api.post('/admin/sites', body) : await api.put(`/admin/sites/${editing.value.id}`, body);
    const i = sites.value.findIndex((s) => s.id === data.id);
    if (i >= 0) sites.value[i] = data; else sites.value.push(data);
    sites.value.sort((a, b) => a.name.localeCompare(b.name));
    if (isNew.value) { editing.value = data; showKey.value = true; } else close();
  } catch (e) {
    const errs = e?.response?.data?.errors;
    if (errs) {
      const mapped = {};
      for (const [k, v] of Object.entries(errs)) mapped[k.startsWith('allowed_origins') ? 'allowed_origins' : k] = mapped[k.split('.')[0]] || v;
      fieldErrors.value = mapped;
    } else formError.value = errorMessage(e, 'Could not save site');
  } finally {
    saving.value = false;
  }
}

async function regenerate() {
  regenerating.value = true;
  formError.value = '';
  try {
    const { data } = await api.post(`/admin/sites/${editing.value.id}/regenerate-key`);
    editing.value = data;
    const i = sites.value.findIndex((s) => s.id === data.id);
    if (i >= 0) sites.value[i] = data;
    confirmRegen.value = false;
    showKey.value = true;
  } catch (e) {
    formError.value = errorMessage(e, 'Could not regenerate key');
  } finally {
    regenerating.value = false;
  }
}

async function copy(text, key) {
  try { await navigator.clipboard.writeText(text); copied.value = key; setTimeout(() => (copied.value = ''), 1500); } catch { /* ignore */ }
}
const maskedKey = (k) => (k ? k.slice(0, 7) + '•'.repeat(24) + k.slice(-4) : '');
const currentSnippets = computed(() => snippets(editing.value));
const activeSnippet = computed(() => currentSnippets.value.find((s) => s.id === snippetTab.value));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">Each website gets its own API key. Leads are labelled by the site whose key was used.</p>
      <button class="btn btn-primary" @click="open(null)">+ Add site</button>
    </div>

    <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ error }}</div>

    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr><th class="px-4 py-3">Site</th><th class="px-4 py-3">Domain</th><th class="px-4 py-3">Allowed origins</th><th class="px-4 py-3">Leads</th><th class="px-4 py-3">Status</th><th class="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="6" class="px-4 py-10 text-center text-muted">Loading…</td></tr>
            <tr v-for="s in sites" :key="s.id" class="border-t border-line hover:bg-surface-2">
              <td class="px-4 py-3"><SiteBadge :name="s.name" :color="s.color" /></td>
              <td class="px-4 py-3">{{ s.domain }}</td>
              <td class="px-4 py-3 text-xs text-muted">
                <div v-for="o in s.allowed_origins" :key="o">{{ o }}</div>
                <span v-if="!s.allowed_origins.length">Any (server-to-server)</span>
              </td>
              <td class="px-4 py-3 tabular-nums">{{ s.lead_count }}</td>
              <td class="px-4 py-3"><Chip :label="s.is_active ? 'Active' : 'Inactive'" :color="s.is_active ? '#10b981' : '#64748b'" /></td>
              <td class="px-4 py-3 text-right"><button class="btn btn-ghost border border-line !py-1.5" @click="open(s)">Manage</button></td>
            </tr>
            <tr v-if="!loading && !sites.length"><td colspan="6" class="px-4 py-10 text-center text-muted">No sites yet. Add your first website.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-if="editing" :title="isNew ? 'Add site' : editing.name" wide @close="close">
      <div class="grid gap-6" :class="isNew ? '' : 'lg:grid-cols-2'">
        <!-- Details form -->
        <form class="space-y-4" novalidate @submit.prevent="save">
          <div v-if="formError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ formError }}</div>
          <div>
            <label class="label" for="s-name">Company / site name</label>
            <input id="s-name" v-model="form.name" class="input" maxlength="150" required />
            <p v-if="fieldErrors.name" class="mt-1 text-xs text-danger">{{ fieldErrors.name }}</p>
          </div>
          <div>
            <label class="label" for="s-domain">Domain</label>
            <input id="s-domain" v-model="form.domain" class="input" placeholder="example.com" maxlength="255" @blur="!form.origins && suggestOrigins()" />
            <p v-if="fieldErrors.domain" class="mt-1 text-xs text-danger">{{ fieldErrors.domain }}</p>
          </div>
          <div>
            <label class="label" for="s-color">Badge colour</label>
            <div class="flex items-center gap-3">
              <input id="s-color" v-model="form.color" type="color" class="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface-2 p-1" />
              <input v-model="form.color" class="input !w-32 font-mono" maxlength="7" aria-label="Colour hex" />
              <SiteBadge :name="form.name || 'Preview'" :color="/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#64748b'" />
            </div>
            <p v-if="fieldErrors.color" class="mt-1 text-xs text-danger">{{ fieldErrors.color }}</p>
          </div>
          <div>
            <div class="flex items-center justify-between">
              <label class="label" for="s-origins">Allowed origins (one per line)</label>
              <button type="button" class="text-xs font-semibold text-primary hover:underline" @click="suggestOrigins">Fill from domain</button>
            </div>
            <textarea id="s-origins" v-model="form.origins" class="input min-h-[80px] font-mono text-xs" placeholder="https://example.com&#10;https://www.example.com" />
            <p class="mt-1 text-xs text-muted">Browsers on other origins are rejected. Leave empty only if the site sends leads from its server.</p>
            <p v-if="fieldErrors.allowed_origins" class="mt-1 text-xs text-danger">{{ fieldErrors.allowed_origins }}</p>
          </div>
          <Toggle v-model="form.is_active" label="Active (accepting leads)" />
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn btn-ghost" @click="close">Cancel</button>
            <button class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : isNew ? 'Create site' : 'Save changes' }}</button>
          </div>
        </form>

        <!-- API key + snippets -->
        <div v-if="!isNew" class="space-y-4">
          <div>
            <span class="label">API key</span>
            <div class="flex items-center gap-2">
              <code class="input flex-1 truncate font-mono text-xs">{{ showKey ? editing.api_key : maskedKey(editing.api_key) }}</code>
              <button class="btn btn-ghost border border-line !px-3" @click="showKey = !showKey">{{ showKey ? 'Hide' : 'Show' }}</button>
              <button class="btn btn-ghost border border-line !px-3" @click="copy(editing.api_key, 'key')">{{ copied === 'key' ? 'Copied ✓' : 'Copy' }}</button>
            </div>
            <div class="mt-2">
              <button v-if="!confirmRegen" class="text-xs font-semibold text-danger hover:underline" @click="confirmRegen = true">Regenerate key…</button>
              <div v-else class="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
                <p>The current key stops working <b>immediately</b>. The website must be updated with the new key.</p>
                <div class="mt-2 flex gap-2">
                  <button class="btn !bg-danger !py-1.5 text-white" :disabled="regenerating" @click="regenerate">{{ regenerating ? 'Regenerating…' : 'Yes, regenerate' }}</button>
                  <button class="btn btn-ghost !py-1.5" @click="confirmRegen = false">Cancel</button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <span class="label">Integration snippet</span>
            <div class="mb-2 inline-flex rounded-xl border border-line bg-surface-2 p-1 text-xs">
              <button v-for="s in currentSnippets" :key="s.id" class="rounded-lg px-3 py-1.5 font-semibold" :class="snippetTab === s.id ? 'bg-primary text-white' : 'text-muted hover:text-ink'" @click="snippetTab = s.id">{{ s.label }}</button>
            </div>
            <p class="mb-2 text-xs text-muted">{{ activeSnippet.note }}</p>
            <div class="relative">
              <pre class="max-h-72 overflow-auto rounded-xl bg-bg p-3 text-[11px] leading-relaxed">{{ activeSnippet.code }}</pre>
              <button class="btn btn-ghost absolute right-2 top-2 border border-line bg-surface !px-2 !py-1 text-xs" @click="copy(activeSnippet.code, 'snip')">{{ copied === 'snip' ? 'Copied ✓' : 'Copy' }}</button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
