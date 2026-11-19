<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { errorMessage } from '../../api/client';
import Toggle from '../Toggle.vue';
import AppIcon from '../AppIcon.vue';

/**
 * Reusable SMTP settings form (global and per-company).
 * - `config`: server data ({ host, port, secure, username, from_name, from_email, has_password, [enabledKey] })
 * - `onSave(body)` / `onTest({ to, config })`: async functions supplied by the parent.
 * The password is never shown; blank means "keep the saved one".
 */
const props = defineProps({
  config: { type: Object, required: true },
  enabledKey: { type: String, default: 'enabled' }, // 'enabled' (global) | 'is_enabled' (company)
  showEnabled: { type: Boolean, default: true },
  forceEnabled: { type: Boolean, default: false }, // company form: the outer switch controls it
  onSave: { type: Function, required: true },
  onTest: { type: Function, required: true },
  label: { type: String, default: 'SMTP' },
});

const PRESETS = [
  { label: 'Gmail / Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false },
  { label: 'Zoho', host: 'smtp.zoho.in', port: 465, secure: true },
];

const form = reactive({});
const errors = ref({});
const formError = ref('');
const saving = ref(false);
const saved = ref(false);
const showPass = ref(false);
let initial = '';

function load(c) {
  Object.assign(form, {
    enabled: props.forceEnabled ? true : !!c[props.enabledKey],
    host: c.host || '',
    port: c.port || 587,
    secure: !!c.secure,
    username: c.username || '',
    password: '',
    from_name: c.from_name || '',
    from_email: c.from_email || '',
  });
  initial = JSON.stringify(form);
  errors.value = {};
  formError.value = '';
}
watch(() => props.config, load, { immediate: true, deep: true });

const dirty = computed(() => JSON.stringify(form) !== initial);
const hasPassword = computed(() => !!props.config.has_password);

// Port and "secure" belong together: 465 = implicit TLS, 587/25 = STARTTLS.
watch(() => form.secure, (s) => { if (s && form.port === 587) form.port = 465; if (!s && form.port === 465) form.port = 587; });
function applyPreset(p) { Object.assign(form, { host: p.host, port: p.port, secure: p.secure }); }

const body = () => ({
  [props.enabledKey]: props.forceEnabled ? true : form.enabled,
  host: form.host.trim(), port: Number(form.port), secure: form.secure, username: form.username.trim(),
  password: form.password || undefined, from_name: form.from_name.trim(), from_email: form.from_email.trim(),
});

function mapErrors(e) {
  const errs = e?.response?.data?.errors;
  errors.value = errs ? Object.fromEntries(Object.entries(errs).map(([k, v]) => [k.split('.').pop(), v])) : {};
  formError.value = errs && Object.keys(errs).length ? '' : errorMessage(e, 'Could not save');
}

async function save() {
  saving.value = true; saved.value = false; errors.value = {}; formError.value = '';
  try {
    await props.onSave(body());
    form.password = '';
    initial = JSON.stringify(form);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) { mapErrors(e); } finally { saving.value = false; }
}

// ---- test email ----
const testOpen = ref(false);
const testTo = ref('');
const testing = ref(false);
const testResult = ref(null); // { ok, message }
async function sendTest() {
  testResult.value = null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.value.trim())) { testResult.value = { ok: false, message: 'Enter a valid recipient email.' }; return; }
  testing.value = true;
  try {
    const { password, ...rest } = body();
    delete rest[props.enabledKey];
    // Test exactly what is on screen (blank password = saved password).
    const res = await props.onTest({ to: testTo.value.trim(), config: { ...rest, password: password || '' } });
    testResult.value = { ok: true, message: res.message || 'Test email sent.' };
  } catch (e) {
    const errs = e?.response?.data?.errors;
    testResult.value = { ok: false, message: errs ? Object.values(errs).join(' · ') : errorMessage(e, 'Test failed') };
  } finally { testing.value = false; }
}
</script>

<template>
  <form class="space-y-5" novalidate @submit.prevent="save">
    <div v-if="showEnabled && !forceEnabled" class="flex items-start justify-between gap-4 rounded-xl border border-line p-4">
      <div>
        <div class="text-sm font-semibold">Send emails with this {{ label }}</div>
        <div class="text-xs text-muted">When off, no lead emails are sent through it.</div>
      </div>
      <Toggle v-model="form.enabled" :label="form.enabled ? 'Enabled' : 'Disabled'" />
    </div>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted">Quick fill:</span>
      <button v-for="p in PRESETS" :key="p.label" type="button" class="rounded-full border border-line px-2.5 py-1 font-semibold text-muted hover:border-primary/50 hover:text-ink" @click="applyPreset(p)">{{ p.label }}</button>
    </div>

    <div class="grid gap-4 sm:grid-cols-[1fr_7rem]">
      <div>
        <label class="label" :for="`${label}-host`">SMTP host</label>
        <input :id="`${label}-host`" v-model="form.host" class="input font-mono text-sm" placeholder="smtp.example.com" autocomplete="off" spellcheck="false" maxlength="255" />
        <p v-if="errors.host" class="mt-1 text-xs text-danger">{{ errors.host }}</p>
      </div>
      <div>
        <label class="label" :for="`${label}-port`">Port</label>
        <input :id="`${label}-port`" v-model.number="form.port" class="input font-mono text-sm" type="number" min="1" max="65535" />
        <p v-if="errors.port" class="mt-1 text-xs text-danger">{{ errors.port }}</p>
      </div>
    </div>

    <div class="flex items-start justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
      <div class="text-xs text-muted">
        <b class="text-ink">SSL/TLS (secure)</b> — on for port 465. Off for 587, which upgrades with STARTTLS (required for remote servers).
      </div>
      <Toggle v-model="form.secure" :label="form.secure ? 'SSL/TLS' : 'STARTTLS'" />
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="label" :for="`${label}-user`">Username</label>
        <input :id="`${label}-user`" v-model="form.username" class="input" autocomplete="off" spellcheck="false" maxlength="255" placeholder="alerts@company.com" />
        <p v-if="errors.username" class="mt-1 text-xs text-danger">{{ errors.username }}</p>
      </div>
      <div>
        <label class="label" :for="`${label}-pass`">Password</label>
        <div class="relative">
          <input
            :id="`${label}-pass`" v-model="form.password" class="input !pr-10" :type="showPass ? 'text' : 'password'"
            autocomplete="new-password" maxlength="500"
            :placeholder="hasPassword ? '•••••••• saved — leave blank to keep' : 'App password'"
          />
          <button type="button" class="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink" :aria-label="showPass ? 'Hide password' : 'Show password'" @click="showPass = !showPass">
            <AppIcon :name="showPass ? 'eyeOff' : 'eye'" :size="16" />
          </button>
        </div>
        <p v-if="errors.password" class="mt-1 text-xs text-danger">{{ errors.password }}</p>
        <p v-else-if="hasPassword" class="mt-1 flex items-center gap-1 text-xs text-success"><AppIcon name="lock" :size="12" /> Saved and encrypted</p>
      </div>
      <div>
        <label class="label" :for="`${label}-fname`">From name</label>
        <input :id="`${label}-fname`" v-model="form.from_name" class="input" maxlength="150" placeholder="Central Leads Panel" />
        <p v-if="errors.from_name" class="mt-1 text-xs text-danger">{{ errors.from_name }}</p>
      </div>
      <div>
        <label class="label" :for="`${label}-femail`">From email</label>
        <input :id="`${label}-femail`" v-model="form.from_email" class="input" type="email" maxlength="200" placeholder="alerts@company.com" />
        <p v-if="errors.from_email" class="mt-1 text-xs text-danger">{{ errors.from_email }}</p>
      </div>
    </div>

    <div v-if="formError" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ formError }}</div>

    <!-- Test email -->
    <div class="rounded-xl border border-line">
      <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold" :aria-expanded="testOpen" @click="testOpen = !testOpen">
        <span class="flex items-center gap-2"><AppIcon name="mail" :size="16" class="text-primary" /> Send test email</span>
        <AppIcon name="chevronDown" :size="16" class="text-muted transition-transform" :class="testOpen ? 'rotate-180' : ''" />
      </button>
      <div v-if="testOpen" class="space-y-3 border-t border-line p-4">
        <p class="text-xs text-muted">Uses the settings on screen (blank password = the saved one). Nothing is saved.</p>
        <div class="flex gap-2">
          <input v-model="testTo" class="input" type="email" placeholder="you@company.com" aria-label="Test recipient" @keydown.enter.prevent="sendTest" />
          <button type="button" class="btn btn-ghost shrink-0 border border-line" :disabled="testing" @click="sendTest">{{ testing ? 'Sending…' : 'Send' }}</button>
        </div>
        <div v-if="testResult" role="status" class="flex items-start gap-2 rounded-lg px-3 py-2 text-sm" :class="testResult.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'">
          <AppIcon :name="testResult.ok ? 'check' : 'warning'" :size="16" class="mt-0.5 shrink-0" />
          <span class="break-words font-mono text-xs leading-relaxed">{{ testResult.message }}</span>
        </div>
      </div>
    </div>

    <div class="flex items-center justify-end gap-3">
      <span v-if="saved" class="flex items-center gap-1 text-sm text-success"><AppIcon name="check" :size="16" /> Saved</span>
      <span v-else-if="dirty" class="text-xs text-muted">Unsaved changes</span>
      <button class="btn btn-primary" :disabled="saving || !dirty">{{ saving ? 'Saving…' : 'Save' }}</button>
    </div>
  </form>
</template>
