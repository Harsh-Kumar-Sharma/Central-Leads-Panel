<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { Line, Bar, Doughnut } from 'vue-chartjs';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Filler, Tooltip, Legend,
} from 'chart.js';
import api, { errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useTheme, cssVar, hexA } from '../utils/theme';
import StatCard from '../components/StatCard.vue';
import AppIcon from '../components/AppIcon.vue';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

const auth = useAuthStore();
const { appearanceKey } = useTheme();
const loading = ref(true);
const error = ref('');
const overview = ref({ today: 0, this_week: 0, this_month: 0, new_unread: 0, by_type: { inquiry: 0, quote: 0 } });
const daily = ref([]);
const bySite = ref([]);
const siteRange = ref('month');
const noSites = computed(() => auth.user && auth.user.role !== 'super_admin' && !(auth.user.site_ids || []).length);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [o, d, s] = await Promise.all([
      api.get('/stats/overview'),
      api.get('/stats/daily', { params: { days: 30 } }),
      api.get('/stats/by-site', { params: { range: siteRange.value } }),
    ]);
    overview.value = o.data;
    daily.value = d.data;
    bySite.value = s.data;
  } catch (e) {
    error.value = errorMessage(e, 'Could not load dashboard');
  } finally {
    loading.value = false;
  }
}
async function loadSites() {
  try {
    bySite.value = (await api.get('/stats/by-site', { params: { range: siteRange.value } })).data;
  } catch (e) {
    error.value = errorMessage(e, 'Could not load company stats');
  }
}
watch(siteRange, loadSites);
onMounted(load);

const fmtDay = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Theme-aware chart palette (recomputed when theme flips).
const palette = computed(() => {
  appearanceKey.value; // re-read CSS variables when mode or accent changes
  return { text: cssVar('--muted') || '#8b95ad', grid: cssVar('--border') || '#232d45', primary: cssVar('--primary') || '#6366f1', surface: cssVar('--surface') || '#131a2b' };
});

const baseOpts = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: '#0b0f1a', titleColor: '#fff', bodyColor: '#e6e9f2', padding: 10, cornerRadius: 8, displayColors: false },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: palette.value.text, maxRotation: 0, autoSkipPadding: 12 }, border: { display: false } },
    y: { beginAtZero: true, grid: { color: palette.value.grid }, ticks: { color: palette.value.text, precision: 0 }, border: { display: false } },
  },
}));

const lineData = computed(() => ({
  labels: daily.value.map((d) => fmtDay(d.date)),
  datasets: [{
    label: 'Leads',
    data: daily.value.map((d) => d.count),
    borderColor: palette.value.primary,
    borderWidth: 2.5,
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 5,
    fill: true,
    backgroundColor: (ctx) => {
      const { chart } = ctx;
      if (!chart.chartArea) return 'transparent';
      const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
      g.addColorStop(0, hexA(palette.value.primary, 0.35));
      g.addColorStop(1, hexA(palette.value.primary, 0));
      return g;
    },
  }],
}));

const barData = computed(() => ({
  labels: bySite.value.map((s) => s.site_name),
  datasets: [{ label: 'Leads', data: bySite.value.map((s) => s.count), backgroundColor: bySite.value.map((s) => s.color), borderRadius: 6, maxBarThickness: 28 }],
}));
const barOpts = computed(() => ({
  ...baseOpts.value,
  indexAxis: 'y',
  scales: {
    x: { ...baseOpts.value.scales.y },
    y: { grid: { display: false }, ticks: { color: palette.value.text }, border: { display: false } },
  },
}));

const typeTotal = computed(() => overview.value.by_type.inquiry + overview.value.by_type.quote);
const doughnutData = computed(() => ({
  labels: ['Inquiry', 'Quote'],
  datasets: [{ data: [overview.value.by_type.inquiry, overview.value.by_type.quote], backgroundColor: ['#06b6d4', '#8b5cf6'], borderColor: palette.value.surface, borderWidth: 3, hoverOffset: 6 }],
}));
const doughnutOpts = computed(() => ({ responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: baseOpts.value.plugins.tooltip } }));
const pct = (n) => (typeTotal.value ? Math.round((n / typeTotal.value) * 100) : 0);
const thirtyDayTotal = computed(() => daily.value.reduce((a, d) => a + d.count, 0));
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-2xl font-bold">Hello, {{ auth.user?.name?.split(' ')[0] }} 👋</h2>
        <p class="text-sm text-muted mt-1">Here is what is coming in from your websites.</p>
      </div>
      <button class="btn btn-ghost border border-line" :disabled="loading" @click="load"><AppIcon name="refresh" :size="16" /> Refresh</button>
    </div>

    <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ error }}</div>

    <div v-if="noSites" class="card p-10 text-center">
      <h3 class="text-lg font-semibold">No companies assigned yet</h3>
      <p class="mt-1 text-sm text-muted">Ask your administrator to assign you to one or more websites.</p>
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today" :value="overview.today" icon="today" :accent="palette.primary" :loading="loading" />
        <StatCard label="This week" :value="overview.this_week" icon="week" accent="#06b6d4" :loading="loading" />
        <StatCard label="This month" :value="overview.this_month" icon="month" accent="#10b981" :loading="loading" />
        <StatCard label="New & unread" :value="overview.new_unread" icon="inbox" accent="#f59e0b" hint="Waiting for follow up" :loading="loading" />
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <div class="card p-5 xl:col-span-2">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold">Leads per day</h3>
              <p class="text-xs text-muted">Last 30 days · {{ thirtyDayTotal }} total</p>
            </div>
          </div>
          <div class="mt-4 h-72"><Line :key="appearanceKey" :data="lineData" :options="baseOpts" /></div>
        </div>

        <div class="card p-5">
          <h3 class="font-semibold">Inquiry vs Quote</h3>
          <p class="text-xs text-muted">This month</p>
          <div class="relative mt-4 h-48">
            <Doughnut :key="appearanceKey" :data="doughnutData" :options="doughnutOpts" />
            <div class="absolute inset-0 grid place-items-center pointer-events-none">
              <div class="text-center"><div class="text-2xl font-bold">{{ typeTotal }}</div><div class="text-xs text-muted">leads</div></div>
            </div>
          </div>
          <div class="mt-5 space-y-2 text-sm">
            <div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-[#06b6d4]" /> Inquiry <span class="ml-auto font-semibold tabular-nums">{{ overview.by_type.inquiry }}</span><span class="w-10 text-right text-muted">{{ pct(overview.by_type.inquiry) }}%</span></div>
            <div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-[#8b5cf6]" /> Quote <span class="ml-auto font-semibold tabular-nums">{{ overview.by_type.quote }}</span><span class="w-10 text-right text-muted">{{ pct(overview.by_type.quote) }}%</span></div>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold">Leads by company</h3>
            <p class="text-xs text-muted">Each website in its own colour</p>
          </div>
          <div class="inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
            <button
              v-for="r in [['today','Today'],['week','Week'],['month','Month'],['all','All time']]" :key="r[0]"
              class="rounded-lg px-3 py-1.5 font-medium transition-colors"
              :class="siteRange === r[0] ? 'bg-primary text-white shadow' : 'text-muted hover:text-ink'"
              @click="siteRange = r[0]"
            >{{ r[1] }}</button>
          </div>
        </div>
        <div class="mt-4" :style="{ height: Math.max(180, bySite.length * 44) + 'px' }">
          <Bar :key="appearanceKey" :data="barData" :options="barOpts" />
        </div>
      </div>
    </template>
  </div>
</template>
