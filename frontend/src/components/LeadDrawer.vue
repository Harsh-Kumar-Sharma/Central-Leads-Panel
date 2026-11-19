<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import api, { errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import {
  STATUSES, statusMeta, typeMeta, fullDate, relativeTime, humanizeKey, whatsappLink, telLink, mailLink, safeUrl,
} from '../utils/format';
import SiteBadge from './SiteBadge.vue';
import Chip from './Chip.vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({ leadId: { type: Number, default: null } });
const emit = defineEmits(['close', 'updated']);
const auth = useAuthStore();

const lead = ref(null);
const loading = ref(false);
const error = ref('');
const savingStatus = ref(false);
const noteText = ref('');
const savingNote = ref(false);
const noteError = ref('');
const showRaw = ref(false);

async function load(id) {
  lead.value = null;
  error.value = '';
  showRaw.value = false;
  noteText.value = '';
  noteError.value = '';
  if (!id) return;
  loading.value = true;
  try {
    const { data } = await api.get(`/leads/${id}`);
    if (props.leadId !== id) return;
    lead.value = data;
    emit('updated', { id, is_read: 1, status: data.status });
  } catch (e) {
    error.value = e?.response?.status === 404 ? 'This lead does not exist or you do not have access to it.' : errorMessage(e, 'Could not load lead');
  } finally {
    loading.value = false;
  }
}
watch(() => props.leadId, load, { immediate: true });

const extraEntries = computed(() => {
  const ex = lead.value?.extra;
  if (!ex || typeof ex !== 'object') return [];
  return Object.entries(ex).map(([k, v]) => [humanizeKey(k), v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
});
const rawJson = computed(() => (lead.value ? JSON.stringify(lead.value.raw_payload, null, 2) : ''));
const sourceHref = computed(() => (lead.value?.source_url ? safeUrl(lead.value.source_url) : null));
const wa = computed(() => whatsappLink(lead.value?.phone));

async function changeStatus(e) {
  const status = e.target.value;
  const prev = lead.value.status;
  lead.value.status = status;
  savingStatus.value = true;
  error.value = '';
  try {
    await api.patch(`/leads/${lead.value.id}`, { status });
    emit('updated', { id: lead.value.id, status });
  } catch (err) {
    lead.value.status = prev;
    error.value = errorMessage(err, 'Could not update status');
  } finally {
    savingStatus.value = false;
  }
}

async function addNote() {
  const note = noteText.value.trim();
  if (!note) return;
  savingNote.value = true;
  noteError.value = '';
  try {
    const { data } = await api.post(`/leads/${lead.value.id}/notes`, { note });
    lead.value.notes.unshift(data);
    noteText.value = '';
  } catch (e) {
    noteError.value = e?.response?.data?.errors?.note || errorMessage(e, 'Could not add note');
  } finally {
    savingNote.value = false;
  }
}

const copied = ref('');
async function copy(text, key) {
  try { await navigator.clipboard.writeText(text); copied.value = key; setTimeout(() => (copied.value = ''), 1200); } catch { /* ignore */ }
}

const onKey = (e) => { if (e.key === 'Escape' && props.leadId) emit('close'); };
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-200">
    <div v-if="leadId" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />
  </Transition>
  <Transition enter-from-class="translate-x-full" leave-to-class="translate-x-full" enter-active-class="transition-transform duration-250 ease-out" leave-active-class="transition-transform duration-200 ease-in">
    <aside v-if="leadId" class="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label="Lead details">
      <!-- Header -->
      <div class="flex items-start gap-3 border-b border-line p-5">
        <div class="min-w-0 flex-1">
          <div v-if="lead" class="flex flex-wrap items-center gap-2">
            <SiteBadge :name="lead.site_name" :color="lead.site_color" />
            <Chip :label="typeMeta(lead.type).label" :color="typeMeta(lead.type).color" />
            <Chip :label="statusMeta(lead.status).label" :color="statusMeta(lead.status).color" />
          </div>
          <h2 class="mt-2 truncate text-xl font-bold">{{ lead?.name || (loading ? 'Loading…' : 'Lead') }}</h2>
          <div v-if="lead" class="mt-1 text-xs text-muted">
            Received {{ relativeTime(lead.created_at) }} · {{ fullDate(lead.created_at) }}
          </div>
          <a v-if="sourceHref" :href="sourceHref" target="_blank" rel="noopener noreferrer nofollow" class="mt-1 block truncate text-xs text-primary hover:underline">{{ lead.source_url }}</a>
          <div v-else-if="lead?.source_url" class="mt-1 truncate text-xs text-muted">{{ lead.source_url }}</div>
        </div>
        <button class="btn-ghost rounded-lg p-2" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </div>

      <div class="flex-1 space-y-6 overflow-y-auto p-5">
        <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{{ error }}</div>
        <div v-if="loading" class="space-y-3">
          <div v-for="i in 5" :key="i" class="h-10 animate-pulse rounded-xl bg-surface-2" />
        </div>

        <template v-if="lead">
          <!-- Quick actions -->
          <div class="grid grid-cols-3 gap-2">
            <a :href="telLink(lead.phone) || undefined" class="btn border border-line" :class="lead.phone ? 'hover:bg-surface-2' : 'pointer-events-none opacity-40'" :aria-disabled="!lead.phone">📞 Call</a>
            <a :href="wa || undefined" target="_blank" rel="noopener noreferrer" class="btn border border-line" :class="wa ? 'hover:bg-surface-2' : 'pointer-events-none opacity-40'" :aria-disabled="!wa">💬 WhatsApp</a>
            <a :href="mailLink(lead.email) || undefined" class="btn border border-line" :class="lead.email ? 'hover:bg-surface-2' : 'pointer-events-none opacity-40'" :aria-disabled="!lead.email">✉️ Email</a>
          </div>

          <!-- Status -->
          <div class="flex items-center gap-3">
            <label class="label !mb-0 shrink-0" for="lead-status">Status</label>
            <select v-if="auth.canEdit" id="lead-status" class="input" :value="lead.status" :disabled="savingStatus" @change="changeStatus">
              <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
            <span v-else class="text-sm"><Chip :label="statusMeta(lead.status).label" :color="statusMeta(lead.status).color" /> <span class="ml-2 text-xs text-muted">(read-only)</span></span>
          </div>

          <!-- Standard fields (rendered as text, never HTML) -->
          <dl class="divide-y divide-line rounded-xl border border-line">
            <div v-for="[k, v, key] in [['Name', lead.name], ['Phone', lead.phone, 'phone'], ['Email', lead.email, 'email'], ['Subject', lead.subject], ['Visitor company', lead.company]]" :key="k" class="flex gap-4 px-4 py-3 text-sm">
              <dt class="w-32 shrink-0 text-muted">{{ k }}</dt>
              <dd class="min-w-0 flex-1 break-words">{{ v || '—' }}</dd>
              <button v-if="key && v" class="text-xs text-primary hover:underline" @click="copy(v, key)">{{ copied === key ? 'Copied' : 'Copy' }}</button>
            </div>
          </dl>

          <div>
            <h3 class="label">Message</h3>
            <p class="whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-4 text-sm leading-relaxed">{{ lead.message || '—' }}</p>
          </div>

          <!-- Extra data: rendered automatically from whatever keys arrive -->
          <div v-if="extraEntries.length">
            <h3 class="label">Extra data</h3>
            <dl class="divide-y divide-line rounded-xl border border-line">
              <div v-for="[k, v] in extraEntries" :key="k" class="flex gap-4 px-4 py-3 text-sm">
                <dt class="w-40 shrink-0 text-muted">{{ k }}</dt>
                <dd class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ v || '—' }}</dd>
              </div>
            </dl>
          </div>

          <!-- Notes -->
          <div>
            <h3 class="label">Notes</h3>
            <form v-if="auth.canEdit" class="mb-3" @submit.prevent="addNote">
              <textarea v-model="noteText" class="input min-h-[80px] resize-y" maxlength="5000" placeholder="Add a note (e.g. called, asked for brochure)…" />
              <div class="mt-2 flex items-center gap-3">
                <span v-if="noteError" class="text-xs text-danger">{{ noteError }}</span>
                <button class="btn btn-primary ml-auto" :disabled="savingNote || !noteText.trim()">{{ savingNote ? 'Saving…' : 'Add note' }}</button>
              </div>
            </form>
            <div v-if="!lead.notes.length" class="text-sm text-muted">No notes yet.</div>
            <ul class="space-y-2">
              <li v-for="n in lead.notes" :key="n.id" class="rounded-xl border border-line p-3">
                <div class="flex items-center gap-2 text-xs text-muted">
                  <span class="font-semibold text-ink">{{ n.user_name }}</span>
                  <span :title="fullDate(n.created_at)">· {{ relativeTime(n.created_at) }}</span>
                </div>
                <p class="mt-1 whitespace-pre-wrap break-words text-sm">{{ n.note }}</p>
              </li>
            </ul>
          </div>

          <!-- Meta + raw payload -->
          <div class="rounded-xl border border-line">
            <button class="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold" :aria-expanded="showRaw" @click="showRaw = !showRaw">
              Raw payload & technical details
              <span class="text-muted">{{ showRaw ? '−' : '+' }}</span>
            </button>
            <div v-if="showRaw" class="space-y-3 border-t border-line p-4">
              <div class="grid gap-1 text-xs text-muted">
                <div><span class="font-semibold">IP:</span> {{ lead.ip || '—' }}</div>
                <div class="break-all"><span class="font-semibold">User agent:</span> {{ lead.user_agent || '—' }}</div>
              </div>
              <pre class="max-h-80 overflow-auto rounded-lg bg-bg p-3 text-xs leading-relaxed">{{ rawJson }}</pre>
            </div>
          </div>
        </template>
      </div>
    </aside>
  </Transition>
</template>
