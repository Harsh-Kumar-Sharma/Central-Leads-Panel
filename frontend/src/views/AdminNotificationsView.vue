<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api, { errorMessage } from '../api/client';
import { relativeTime, fullDate } from '../utils/format';
import SmtpForm from '../components/admin/SmtpForm.vue';
import RecipientsEditor from '../components/admin/RecipientsEditor.vue';
import SiteBadge from '../components/SiteBadge.vue';
import Chip from '../components/Chip.vue';
import Toggle from '../components/Toggle.vue';
import AppIcon from '../components/AppIcon.vue';

const route = useRoute();
const router = useRouter();

const TABS = [
  { id: 'smtp', label: 'Global SMTP', icon: 'mail' },
  { id: 'recipients', label: 'Global recipients', icon: 'users' },
  { id: 'companies', label: 'Companies', icon: 'globe' },
  { id: 'log', label: 'Email log', icon: 'inbox' },
];
const tab = computed(() => (TABS.some((t) => t.id === route.query.tab) ? route.query.tab : 'smtp'));
const setTab = (id) => router.replace({ query: { ...route.query, tab: id } });

const sites = ref([]);
const pageError = ref('');

// ---------------- Global SMTP ----------------
const globalSmtp = ref(null);
async function loadGlobal() { globalSmtp.value = (await api.get('/admin/settings/smtp-global')).data; }
const saveGlobal = async (body) => { globalSmtp.value = (await api.put('/admin/settings/smtp-global', body)).data; refreshPreview(); };
const testGlobal = async (payload) => (await api.post('/admin/settings/smtp-global/test', payload)).data;

// ---------------- Global recipients ----------------
const globalRecipients = ref([]);
async function loadGlobalRecipients() { globalRecipients.value = (await api.get('/admin/settings/global-recipients')).data; }
const saveGlobalRecipients = async (list) => { globalRecipients.value = (await api.put('/admin/settings/global-recipients', list)).data; refreshPreview(); };

// ---------------- Companies ----------------
const siteId = ref(null);
const site = computed(() => sites.value.find((s) => s.id === siteId.value));
const siteSmtp = ref(null);
const siteRecipients = ref([]);
const preview = ref(null);
const siteLoading = ref(false);
const siteError = ref('');
const togglingSmtp = ref(false);

async function loadSite(id) {
  if (!id) return;
  siteLoading.value = true;
  siteError.value = '';
  try {
    const [s, r, p] = await Promise.all([
      api.get(`/admin/sites/${id}/smtp`), api.get(`/admin/sites/${id}/recipients`), api.get(`/admin/sites/${id}/notification-preview`),
    ]);
    if (id !== siteId.value) return;
    siteSmtp.value = s.data;
    siteRecipients.value = r.data;
    preview.value = p.data;
  } catch (e) {
    siteError.value = errorMessage(e, 'Could not load company settings');
  } finally {
    siteLoading.value = false;
  }
}
async function refreshPreview() {
  if (siteId.value) { try { preview.value = (await api.get(`/admin/sites/${siteId.value}/notification-preview`)).data; } catch { /* ignore */ } }
}
watch(siteId, (id) => { router.replace({ query: { ...route.query, site: id || undefined } }); loadSite(id); });

const saveSiteRecipients = async (list) => { siteRecipients.value = (await api.put(`/admin/sites/${siteId.value}/recipients`, list)).data; refreshPreview(); };
const saveSiteSmtp = async (body) => { siteSmtp.value = (await api.put(`/admin/sites/${siteId.value}/smtp`, body)).data; refreshPreview(); };
const testSiteSmtp = async (payload) => (await api.post(`/admin/sites/${siteId.value}/smtp/test`, payload)).data;

// Separate-SMTP switch: turning it ON reveals the form (saved with "Save"); turning it OFF saves immediately.
const separateSmtp = ref(false);
watch(siteSmtp, (s) => { separateSmtp.value = !!s?.is_enabled; });
async function onSeparateToggle(on) {
  separateSmtp.value = on;
  if (on || !siteSmtp.value?.is_enabled) return;
  togglingSmtp.value = true;
  try {
    const { has_password, updated_at, site_id, ...rest } = siteSmtp.value;
    await saveSiteSmtp({ ...rest, is_enabled: false });
  } catch (e) {
    separateSmtp.value = true;
    siteError.value = errorMessage(e, 'Could not switch back to global SMTP');
  } finally { togglingSmtp.value = false; }
}

// ---------------- Email log ----------------
const logs = ref({ data: [], total: 0, page: 1, page_size: 25 });
const logFilter = ref({ site_id: '', status: '' });
const logPage = ref(1);
const logLoading = ref(false);
const logError = ref('');
const retrying = ref(null);
async function loadLogs() {
  logLoading.value = true;
  logError.value = '';
  try {
    const params = { page: logPage.value, page_size: 25 };
    if (logFilter.value.site_id) params.site_id = logFilter.value.site_id;
    if (logFilter.value.status) params.status = logFilter.value.status;
    logs.value = (await api.get('/admin/email-logs', { params })).data;
  } catch (e) {
    logError.value = errorMessage(e, 'Could not load the email log');
  } finally { logLoading.value = false; }
}
watch(logFilter, () => { logPage.value = 1; loadLogs(); }, { deep: true });
watch(logPage, loadLogs);
async function retry(row) {
  retrying.value = row.id;
  try {
    const updated = (await api.post(`/admin/email-logs/${row.id}/retry`)).data;
    const i = logs.value.data.findIndex((r) => r.id === row.id);
    if (i >= 0) logs.value.data[i] = updated;
  } catch (e) {
    logError.value = errorMessage(e, 'Retry failed');
  } finally { retrying.value = null; }
}
const logPages = computed(() => Math.max(1, Math.ceil(logs.value.total / 25)));
const LOG_STATUS = { sent: ['Sent', '#10b981'], failed: ['Failed', '#ef4444'], retrying: ['Retrying', '#f59e0b'], pending: ['Pending', '#6366f1'] };
const rcptSummary = (r) => [...r.to_addresses.map((e) => e), ...r.cc_addresses.map((e) => `cc: ${e}`), ...r.bcc_addresses.map((e) => `bcc: ${e}`)];

// ---------------- init ----------------
watch(tab, (t) => { if (t === 'log') loadLogs(); });
onMounted(async () => {
  try {
    const [s] = await Promise.all([api.get('/admin/sites'), loadGlobal(), loadGlobalRecipients()]);
    sites.value = s.data;
    const fromUrl = Number(route.query.site);
    siteId.value = sites.value.some((x) => x.id === fromUrl) ? fromUrl : sites.value[0]?.id || null;
    if (tab.value === 'log') loadLogs();
  } catch (e) {
    pageError.value = errorMessage(e, 'Could not load notification settings');
  }
});

const smtpStatus = computed(() => {
  const g = globalSmtp.value;
  if (!g) return null;
  if (g.enabled && g.has_password && g.host) return { ok: true, text: `Global SMTP active · ${g.host}:${g.port}` };
  return { ok: false, text: 'Global SMTP is not active: leads will only email companies with their own SMTP.' };
});
</script>

<template>
  <div class="space-y-5">
    <div v-if="pageError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ pageError }}</div>

    <!-- status strip -->
    <div v-if="smtpStatus" class="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm" :class="smtpStatus.ok ? 'border-success/30 bg-success/[0.07]' : 'border-warning/40 bg-warning/[0.08]'">
      <span class="h-2 w-2 shrink-0 rounded-full" :class="smtpStatus.ok ? 'bg-success' : 'bg-warning'" />
      <span>{{ smtpStatus.text }}</span>
      <button v-if="!smtpStatus.ok && tab !== 'smtp'" class="ml-auto text-xs font-semibold text-primary hover:underline" @click="setTab('smtp')">Set up</button>
    </div>

    <!-- tabs -->
    <div class="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1" role="tablist" aria-label="Notification settings">
      <button
        v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id"
        class="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition"
        :class="tab === t.id ? 'bg-primary text-white shadow' : 'text-muted hover:bg-surface-2 hover:text-ink'"
        @click="setTab(t.id)"
      >
        <AppIcon :name="t.icon" :size="17" /> {{ t.label }}
      </button>
    </div>

    <!-- 1. Global SMTP -->
    <section v-if="tab === 'smtp'" class="card p-5 sm:p-6" role="tabpanel">
      <h2 class="font-semibold">Global SMTP</h2>
      <p class="mb-5 mt-1 text-sm text-muted">Used for every company that does not have its own SMTP.</p>
      <SmtpForm v-if="globalSmtp" :config="globalSmtp" enabled-key="enabled" label="global SMTP" :on-save="saveGlobal" :on-test="testGlobal" />
      <div v-else class="h-40 animate-pulse rounded-xl bg-surface-2" />
    </section>

    <!-- 2. Global recipients -->
    <section v-if="tab === 'recipients'" class="card p-5 sm:p-6" role="tabpanel">
      <h2 class="font-semibold">Global recipients</h2>
      <p class="mt-1 text-sm text-muted">These people receive a copy of <b class="text-ink">every company's</b> leads.</p>
      <div class="mt-5">
        <RecipientsEditor :items="globalRecipients" :on-save="saveGlobalRecipients" />
      </div>
    </section>

    <!-- 3. Companies -->
    <section v-if="tab === 'companies'" class="space-y-5" role="tabpanel">
      <div class="card flex flex-wrap items-center gap-3 p-4">
        <label class="label !mb-0" for="company-pick">Company</label>
        <select id="company-pick" v-model.number="siteId" class="input !w-auto min-w-[14rem]">
          <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}{{ s.is_active ? '' : ' (inactive)' }}</option>
        </select>
        <SiteBadge v-if="site" :name="site.name" :color="site.color" />
      </div>

      <div v-if="siteError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ siteError }}</div>
      <div v-if="siteLoading && !siteSmtp" class="h-40 animate-pulse rounded-2xl bg-surface-2" />

      <template v-if="site && siteSmtp">
        <!-- Resolved preview -->
        <div v-if="preview" class="card p-5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-semibold">What happens for a new {{ site.name }} lead</h3>
          </div>
          <div class="mt-3 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <div class="text-muted">Sent with</div>
            <div>
              <Chip v-if="preview.smtp_source === 'site'" label="Company SMTP" color="#8b5cf6" />
              <Chip v-else-if="preview.smtp_source === 'global'" label="Global SMTP" color="#0284c7" />
              <Chip v-else label="No SMTP — email will not be sent" color="#ef4444" />
            </div>
            <div class="text-muted">Recipients</div>
            <div class="space-y-1">
              <div v-if="!preview.recipients.to.length" class="text-danger">Nobody — add company or global recipients.</div>
              <div v-for="m in ['to', 'cc', 'bcc']" v-show="preview.recipients[m].length" :key="m" class="flex flex-wrap items-center gap-1.5">
                <span class="w-9 text-xs font-bold uppercase text-muted">{{ m }}</span>
                <span v-for="e in preview.recipients[m]" :key="e" class="rounded-md bg-surface-2 px-2 py-0.5 text-xs">{{ e }}</span>
              </div>
              <p class="pt-1 text-xs text-muted">Company + global recipients, de-duplicated (To beats CC beats BCC).</p>
            </div>
          </div>
        </div>

        <div class="card p-5 sm:p-6">
          <h3 class="font-semibold">Company recipients</h3>
          <div class="mt-4">
            <RecipientsEditor :items="siteRecipients" with-active :on-save="saveSiteRecipients" help="People who get this company's leads (global recipients are added automatically)." />
          </div>
        </div>

        <div class="card p-5 sm:p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="font-semibold">Use a separate SMTP for this company</h3>
              <p class="mt-1 text-sm text-muted">Send this company's emails from its own mailbox.</p>
            </div>
            <Toggle :model-value="separateSmtp" :disabled="togglingSmtp" :label="separateSmtp ? 'On' : 'Off'" @update:model-value="onSeparateToggle" />
          </div>
          <div v-if="!separateSmtp" class="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            <AppIcon name="mail" :size="16" /> Using global SMTP.
          </div>
          <div v-else class="mt-5 border-t border-line pt-5">
            <p v-if="!siteSmtp.is_enabled" class="mb-4 rounded-xl bg-warning/10 px-4 py-2.5 text-xs text-warning">Fill in the settings and press Save to switch this company to its own SMTP.</p>
            <SmtpForm :config="siteSmtp" enabled-key="is_enabled" force-enabled :show-enabled="false" :label="`${site.name} SMTP`" :on-save="saveSiteSmtp" :on-test="testSiteSmtp" />
          </div>
        </div>
      </template>
      <div v-if="!sites.length && !pageError" class="card p-10 text-center text-sm text-muted">Add a site first under Admin → Sites.</div>
    </section>

    <!-- 4. Email log -->
    <section v-if="tab === 'log'" class="card overflow-hidden" role="tabpanel">
      <div class="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <div>
          <label class="label" for="log-site">Company</label>
          <select id="log-site" v-model="logFilter.site_id" class="input !w-auto min-w-[12rem]">
            <option value="">All companies</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="log-status">Status</label>
          <select id="log-status" v-model="logFilter.status" class="input !w-auto">
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="retrying">Retrying</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <button class="btn btn-ghost ml-auto border border-line" :disabled="logLoading" @click="loadLogs"><AppIcon name="refresh" :size="16" /> Refresh</button>
      </div>
      <div v-if="logError" role="alert" class="m-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ logError }}</div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[960px] text-sm">
          <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr><th class="px-4 py-3">Time</th><th class="px-4 py-3">Company</th><th class="px-4 py-3">Subject</th><th class="px-4 py-3">Recipients</th><th class="px-4 py-3">SMTP</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Error</th><th class="px-4 py-3"></th></tr>
          </thead>
          <tbody :class="logLoading ? 'opacity-60' : ''">
            <tr v-for="r in logs.data" :key="r.id" class="border-t border-line align-top">
              <td class="whitespace-nowrap px-4 py-3 text-muted" :title="fullDate(r.created_at)">{{ relativeTime(r.created_at) }}</td>
              <td class="px-4 py-3"><SiteBadge v-if="r.site_name" :name="r.site_name" :color="r.site_color" /></td>
              <td class="max-w-[16rem] px-4 py-3"><div class="truncate" :title="r.subject">{{ r.subject }}</div></td>
              <td class="max-w-[14rem] px-4 py-3 text-xs">
                <div class="truncate" :title="rcptSummary(r).join('\n')">{{ rcptSummary(r)[0] || '—' }}</div>
                <div v-if="rcptSummary(r).length > 1" class="text-muted">+{{ rcptSummary(r).length - 1 }} more</div>
              </td>
              <td class="px-4 py-3 text-xs capitalize">{{ r.smtp_source }}</td>
              <td class="whitespace-nowrap px-4 py-3">
                <Chip :label="(LOG_STATUS[r.status] || [r.status])[0]" :color="(LOG_STATUS[r.status] || [0, '#64748b'])[1]" />
                <div class="mt-1 text-[11px] text-muted">{{ r.attempts }} attempt{{ r.attempts === 1 ? '' : 's' }}</div>
              </td>
              <td class="max-w-[16rem] px-4 py-3 font-mono text-[11px] text-danger"><div class="line-clamp-2 break-words" :title="r.error">{{ r.error || '' }}</div></td>
              <td class="px-4 py-3 text-right">
                <button v-if="r.status === 'failed' && r.lead_id" class="btn btn-ghost border border-line !px-3 !py-1.5 text-xs" :disabled="retrying === r.id" @click="retry(r)">{{ retrying === r.id ? 'Retrying…' : 'Retry' }}</button>
              </td>
            </tr>
            <tr v-if="!logLoading && !logs.data.length"><td colspan="8" class="px-4 py-12 text-center text-muted">No emails yet.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-3 border-t border-line px-4 py-3 text-sm">
        <span class="text-muted">{{ logs.total }} email{{ logs.total === 1 ? '' : 's' }}</span>
        <div class="ml-auto flex items-center gap-1">
          <button class="btn btn-ghost !px-3 !py-1.5" :disabled="logPage <= 1" @click="logPage--">‹ Prev</button>
          <span class="px-2 tabular-nums">{{ logPage }} / {{ logPages }}</span>
          <button class="btn btn-ghost !px-3 !py-1.5" :disabled="logPage >= logPages" @click="logPage++">Next ›</button>
        </div>
      </div>
    </section>
  </div>
</template>
