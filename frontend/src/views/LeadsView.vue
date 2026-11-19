<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api, { errorMessage } from '../api/client';
import { STATUSES, TYPES, statusMeta, typeMeta, relativeTime, fullDate, rangeDates } from '../utils/format';
import SiteBadge from '../components/SiteBadge.vue';
import Chip from '../components/Chip.vue';
import MultiSelect from '../components/MultiSelect.vue';
import LeadDrawer from '../components/LeadDrawer.vue';
import AppIcon from '../components/AppIcon.vue';

const route = useRoute();
const router = useRouter();

const sites = ref([]);
const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
const exporting = ref('');

const RANGES = [
  { value: '', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'custom', label: 'Custom range' },
];
const COLUMNS = [
  { key: 'site', label: 'Company', sortable: true }, { key: 'type', label: 'Type' }, { key: 'name', label: 'Name', sortable: true },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'message', label: 'Message' },
  { key: 'created_at', label: 'Received', sortable: true }, { key: 'status', label: 'Status', sortable: true },
];

// ---- URL <-> filter state (URL is the source of truth, so filters survive refresh) ----
const str = (v) => (typeof v === 'string' ? v : '');
const list = (v) => str(v).split(',').filter(Boolean);
const q = computed(() => route.query);
const filters = computed(() => ({
  site_ids: list(q.value.site_ids).map(Number).filter((n) => Number.isInteger(n) && n > 0),
  type: TYPES.some((t) => t.value === q.value.type) ? q.value.type : '',
  status: list(q.value.status).filter((s) => STATUSES.some((x) => x.value === s)),
  range: RANGES.some((r) => r.value === q.value.range) ? q.value.range : '',
  from: /^\d{4}-\d{2}-\d{2}$/.test(str(q.value.from)) ? q.value.from : '',
  to: /^\d{4}-\d{2}-\d{2}$/.test(str(q.value.to)) ? q.value.to : '',
  q: str(q.value.q).slice(0, 100),
  sort: ['created_at', 'name', 'status', 'site'].includes(q.value.sort) ? q.value.sort : 'created_at',
  order: q.value.order === 'asc' ? 'asc' : 'desc',
  page: Math.max(1, parseInt(str(q.value.page), 10) || 1),
  page_size: [25, 50, 100].includes(Number(q.value.page_size)) ? Number(q.value.page_size) : 25,
}));
const openId = computed(() => { const n = Number(q.value.lead); return Number.isInteger(n) && n > 0 ? n : null; });

function setQuery(patch, { resetPage = true } = {}) {
  const next = { ...route.query, ...patch };
  if (resetPage && !('page' in patch)) delete next.page;
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)) delete next[k];
    else if (Array.isArray(v)) next[k] = v.join(',');
    else next[k] = String(v);
  }
  router.replace({ query: next });
}

// Debounced search box
const search = ref(filters.value.q);
let t;
watch(search, (v) => { clearTimeout(t); t = setTimeout(() => setQuery({ q: v.trim() }), 400); });
watch(() => filters.value.q, (v) => { if (v !== search.value.trim()) search.value = v; });

const custom = reactive({ from: filters.value.from, to: filters.value.to });
function setRange(r) {
  if (r === 'custom') setQuery({ range: 'custom', from: custom.from || rangeDates('month').from, to: custom.to || rangeDates('today').to });
  else setQuery({ range: r, from: '', to: '' });
}
watch(() => [filters.value.from, filters.value.to], ([f, to]) => { custom.from = f; custom.to = to; });

const apiParams = computed(() => {
  const f = filters.value;
  const dates = f.range === 'custom' ? { from: f.from, to: f.to } : rangeDates(f.range);
  const p = { sort: f.sort, order: f.order, page: f.page, page_size: f.page_size };
  if (f.site_ids.length) p.site_ids = f.site_ids.join(',');
  if (f.type) p.type = f.type;
  if (f.status.length) p.status = f.status.join(',');
  if (dates.from) p.from = dates.from;
  if (dates.to) p.to = dates.to;
  if (f.q) p.q = f.q;
  return p;
});

const hasFilters = computed(() => { const f = filters.value; return !!(f.site_ids.length || f.type || f.status.length || f.range || f.q); });
const clearFilters = () => { search.value = ''; router.replace({ query: {} }); };

let reqSeq = 0;
async function load() {
  const seq = ++reqSeq;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get('/leads', { params: apiParams.value });
    if (seq !== reqSeq) return; // ignore stale responses
    rows.value = data.data;
    total.value = data.total;
  } catch (e) {
    if (seq === reqSeq) error.value = errorMessage(e, 'Could not load leads');
  } finally {
    if (seq === reqSeq) loading.value = false;
  }
}
// Compare by value so opening the drawer (which only changes ?lead=) does not refetch the list.
watch(() => JSON.stringify(apiParams.value), load);

onMounted(async () => {
  load();
  try { sites.value = (await api.get('/sites')).data; } catch { /* filter just stays empty */ }
});

const siteOptions = computed(() => sites.value.map((s) => ({ value: s.id, label: s.name, color: s.color })));
const statusOptions = STATUSES.map((s) => ({ value: s.value, label: s.label, color: s.color }));

function sortBy(key) {
  const f = filters.value;
  setQuery({ sort: key, order: f.sort === key && f.order === 'desc' ? 'asc' : 'desc' });
}
const pages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.page_size)));
const fromRow = computed(() => (total.value ? (filters.value.page - 1) * filters.value.page_size + 1 : 0));
const toRow = computed(() => Math.min(total.value, filters.value.page * filters.value.page_size));

const openLead = (row) => setQuery({ lead: row.id }, { resetPage: false });
const closeLead = () => setQuery({ lead: '' }, { resetPage: false });
function onLeadUpdated(patch) {
  const r = rows.value.find((x) => x.id === patch.id);
  if (r) Object.assign(r, patch);
}

async function exportFile(format) {
  exporting.value = format;
  try {
    const { page, page_size, ...params } = apiParams.value;
    const res = await api.get('/leads/export', { params: { ...params, format }, responseType: 'blob', timeout: 120000 });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = errorMessage(e, 'Export failed');
  } finally {
    exporting.value = '';
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Filters -->
    <div class="card p-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div class="xl:col-span-2">
          <label class="label" for="lead-search">Search</label>
          <div class="relative">
            <input id="lead-search" v-model="search" class="input pl-9" type="search" maxlength="100" placeholder="Name, phone, email, message…" />
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </div>
        </div>
        <div>
          <span class="label">Company</span>
          <MultiSelect label="Company" :model-value="filters.site_ids" :options="siteOptions" placeholder="All companies" @update:model-value="(v) => setQuery({ site_ids: v })" />
        </div>
        <div>
          <label class="label" for="f-type">Type</label>
          <select id="f-type" class="input" :value="filters.type" @change="setQuery({ type: $event.target.value })">
            <option value="">All types</option>
            <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
        <div>
          <span class="label">Status</span>
          <MultiSelect label="Status" :model-value="filters.status" :options="statusOptions" placeholder="All (excl. spam)" @update:model-value="(v) => setQuery({ status: v })" />
        </div>
        <div>
          <label class="label" for="f-range">Date</label>
          <select id="f-range" class="input" :value="filters.range" @change="setRange($event.target.value)">
            <option v-for="r in RANGES" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="filters.range === 'custom'" class="mt-3 flex flex-wrap items-end gap-3">
        <div><label class="label" for="f-from">From</label><input id="f-from" v-model="custom.from" type="date" class="input" :max="custom.to || undefined" @change="setQuery({ from: custom.from })" /></div>
        <div><label class="label" for="f-to">To</label><input id="f-to" v-model="custom.to" type="date" class="input" :min="custom.from || undefined" @change="setQuery({ to: custom.to })" /></div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-sm text-muted">{{ loading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'}` }}</span>
        <button v-if="hasFilters" class="btn btn-ghost text-xs" @click="clearFilters">Clear filters</button>
        <div class="ml-auto flex gap-2">
          <button class="btn btn-ghost border border-line" :disabled="!!exporting || !total" @click="exportFile('csv')">{{ exporting === 'csv' ? 'Exporting…' : 'Export CSV' }}</button>
          <button class="btn btn-primary" :disabled="!!exporting || !total" @click="exportFile('xlsx')">{{ exporting === 'xlsx' ? 'Exporting…' : 'Export Excel' }}</button>
        </div>
      </div>
    </div>

    <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ error }}</div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[960px] text-sm">
          <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th v-for="c in COLUMNS" :key="c.key" class="px-4 py-3 font-semibold whitespace-nowrap">
                <button v-if="c.sortable" class="inline-flex items-center gap-1 uppercase hover:text-ink" @click="sortBy(c.key)">
                  {{ c.label }}
                  <span v-if="filters.sort === c.key" class="text-primary">{{ filters.order === 'asc' ? '▲' : '▼' }}</span>
                </button>
                <span v-else>{{ c.label }}</span>
              </th>
            </tr>
          </thead>
          <tbody :class="loading ? 'opacity-60' : ''">
            <tr
              v-for="r in rows" :key="r.id"
              class="cursor-pointer border-t border-line transition-colors hover:bg-surface-2"
              :class="[!r.is_read ? 'font-semibold' : 'text-ink/85', openId === r.id ? 'bg-primary/10' : '']"
              tabindex="0" @click="openLead(r)" @keydown.enter="openLead(r)"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 shrink-0 rounded-full" :class="!r.is_read ? 'bg-primary' : 'bg-transparent'" :title="!r.is_read ? 'Unread' : ''" />
                  <SiteBadge :name="r.site_name" :color="r.site_color" />
                </div>
              </td>
              <td class="px-4 py-3"><Chip :label="typeMeta(r.type).label" :color="typeMeta(r.type).color" /></td>
              <td class="px-4 py-3 whitespace-nowrap">{{ r.name }}</td>
              <td class="px-4 py-3 whitespace-nowrap tabular-nums">{{ r.phone || '' }}</td>
              <td class="px-4 py-3 max-w-[14rem] truncate">{{ r.email || '' }}</td>
              <td class="px-4 py-3 max-w-[18rem] truncate text-muted" :title="r.message_preview">{{ r.message_preview ? r.message_preview.slice(0, 80) : '' }}</td>
              <td class="px-4 py-3 whitespace-nowrap text-muted" :title="fullDate(r.created_at)">{{ relativeTime(r.created_at) }}</td>
              <td class="px-4 py-3"><Chip :label="statusMeta(r.status).label" :color="statusMeta(r.status).color" /></td>
            </tr>
            <tr v-if="!loading && !rows.length">
              <td :colspan="COLUMNS.length" class="px-4 py-16 text-center">
                <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><AppIcon name="inbox" /></div>
                <div class="font-semibold">No leads found</div>
                <div class="mt-1 text-sm text-muted">{{ hasFilters ? 'Try changing or clearing the filters.' : 'Leads from your websites will appear here.' }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
        <span class="text-muted">{{ fromRow }}–{{ toRow }} of {{ total }}</span>
        <select class="input !w-auto !py-1.5" :value="filters.page_size" aria-label="Rows per page" @change="setQuery({ page_size: $event.target.value })">
          <option v-for="n in [25, 50, 100]" :key="n" :value="n">{{ n }} / page</option>
        </select>
        <div class="ml-auto flex items-center gap-1">
          <button class="btn btn-ghost !px-3 !py-1.5" :disabled="filters.page <= 1" @click="setQuery({ page: filters.page - 1 }, { resetPage: false })">‹ Prev</button>
          <span class="px-2 tabular-nums">{{ filters.page }} / {{ pages }}</span>
          <button class="btn btn-ghost !px-3 !py-1.5" :disabled="filters.page >= pages" @click="setQuery({ page: filters.page + 1 }, { resetPage: false })">Next ›</button>
        </div>
      </div>
    </div>

    <LeadDrawer :lead-id="openId" @close="closeLead" @updated="onLeadUpdated" />
  </div>
</template>
