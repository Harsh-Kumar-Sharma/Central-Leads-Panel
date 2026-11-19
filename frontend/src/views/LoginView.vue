<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { errorMessage } from '../api/client';
import AppIcon from '../components/AppIcon.vue';
import AppearanceMenu from '../components/AppearanceMenu.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const REMEMBER_KEY = 'clp-last-email';
const store = {
  get: () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(REMEMBER_KEY, v) : localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ } },
};

const email = ref(store.get());
const remember = ref(!!email.value);
const password = ref('');
const showPassword = ref(false);
const capsLock = ref(false);
const error = ref('');
const shake = ref(false);
const loading = ref(false);
const touched = ref({ email: false, password: false });
const emailEl = ref(null);
const passwordEl = ref(null);

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
const emailError = computed(() => (touched.value.email && email.value && !emailValid.value ? 'Enter a valid email address' : ''));
const canSubmit = computed(() => emailValid.value && password.value.length > 0 && !loading.value);
const sessionExpired = computed(() => typeof route.query.redirect === 'string' && !error.value);
const year = new Date().getFullYear();

onMounted(async () => {
  await nextTick();
  (email.value ? passwordEl : emailEl).value?.focus();
});

function onKey(e) {
  if (typeof e.getModifierState === 'function') capsLock.value = e.getModifierState('CapsLock');
}

function safeRedirect() {
  const r = route.query.redirect;
  // Only same-app paths: "/x", never "//host" or "/\host".
  return typeof r === 'string' && /^\/(?![/\\])/.test(r) ? r : '/';
}

async function submit() {
  touched.value = { email: true, password: true };
  if (!canSubmit.value) return;
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value);
    store.set(remember.value ? email.value.trim().toLowerCase() : '');
    router.replace(safeRedirect());
  } catch (e) {
    error.value = e?.response?.status === 429
      ? errorMessage(e)
      : e?.response ? errorMessage(e, 'Invalid email or password') : 'Cannot reach the server. Check your connection and try again.';
    password.value = '';
    showPassword.value = false; // never leave a re-typed password visible
    shake.value = false;
    await nextTick();
    shake.value = true;
    passwordEl.value?.focus();
  } finally {
    loading.value = false;
  }
}

const features = [
  { icon: 'inbox', title: 'One inbox for every website', text: 'Contact and quote forms from all company sites land here, labelled by company.' },
  { icon: 'shield', title: 'Access by company', text: 'Managers and viewers only see the websites assigned to them.' },
  { icon: 'month', title: 'Follow up faster', text: 'Status, notes, WhatsApp & call shortcuts, and Excel export in one click.' },
];
</script>

<template>
  <div class="relative min-h-full lg:grid lg:grid-cols-[1.05fr_1fr]">
    <!-- ============ Brand / story panel ============ -->
    <section class="brand relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:gap-10 lg:p-12 xl:p-16" aria-hidden="true">
      <div class="grid-bg absolute inset-0 opacity-[0.07]" />
      <div class="blob absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full" />
      <div class="blob-2 absolute -bottom-32 -left-20 h-96 w-96 rounded-full" />

      <div class="relative flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V7l8 6 8-6v11" /></svg>
        </div>
        <div class="leading-tight">
          <div class="text-lg font-bold tracking-tight">Central Leads</div>
          <div class="text-xs text-white/65">Lead management console</div>
        </div>
      </div>

      <div class="relative max-w-xl">
        <h2 class="text-4xl font-bold leading-[1.15] tracking-tight xl:text-[2.75rem]">
          Every enquiry from every website, <span class="text-white/70">in one place.</span>
        </h2>

        <!-- Product preview card -->
        <div class="preview mt-8 rounded-2xl p-4 ring-1 ring-white/20 backdrop-blur-md">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold text-white/80">Leads this week</div>
            <div class="flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live</div>
          </div>
          <div class="mt-3 flex h-16 items-end gap-1.5">
            <div v-for="(h, i) in [35, 55, 40, 70, 50, 85, 65]" :key="i" class="flex-1 rounded-t-md bg-white/30" :style="{ height: h + '%', opacity: 0.45 + i * 0.08 }" />
          </div>
          <div class="mt-4 space-y-2">
            <div v-for="row in [['Skyline Aviation', 'Quote', '2m'], ['GreenBuild Infra', 'Inquiry', '14m']]" :key="row[0]" class="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-xs">
              <span class="h-2 w-2 rounded-full bg-white" />
              <span class="font-semibold">{{ row[0] }}</span>
              <span class="rounded bg-white/15 px-1.5 py-0.5 text-[10px]">{{ row[1] }}</span>
              <span class="ml-auto text-white/60">{{ row[2] }} ago</span>
            </div>
          </div>
        </div>

        <ul class="mt-8 grid gap-4">
          <li v-for="f in features" :key="f.title" class="flex gap-4">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20"><AppIcon :name="f.icon" :size="20" /></div>
            <div>
              <div class="font-semibold">{{ f.title }}</div>
              <div class="mt-0.5 text-sm text-white/65">{{ f.text }}</div>
            </div>
          </li>
        </ul>
      </div>

      <div class="relative flex items-center justify-between text-xs text-white/55">
        <span>© {{ year }} Central Leads</span>
        <span class="flex items-center gap-1.5"><AppIcon name="lock" :size="13" /> Encrypted, rate-limited sessions</span>
      </div>
    </section>

    <!-- ============ Form panel ============ -->
    <section class="form-side relative flex min-h-full flex-col">
      <div class="flex items-center justify-between p-5 sm:p-8">
        <div class="flex items-center gap-2.5 lg:invisible">
          <div class="logo grid h-9 w-9 place-items-center rounded-xl text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V7l8 6 8-6v11" /></svg>
          </div>
          <span class="font-bold tracking-tight">Central Leads</span>
        </div>
        <AppearanceMenu />
      </div>

      <div class="flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
        <form class="w-full max-w-[400px]" :class="shake ? 'shake' : ''" novalidate @submit.prevent="submit" @animationend="shake = false">
          <div class="mb-8">
            <div class="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-muted">
              <span class="h-1.5 w-1.5 rounded-full bg-success" /> Secure admin access
            </div>
            <h1 class="text-[28px] font-bold leading-tight tracking-tight">Welcome back</h1>
            <p class="mt-1.5 text-sm text-muted">Sign in to manage leads from all your websites.</p>
          </div>

          <div v-if="sessionExpired" class="mb-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-muted">
            <AppIcon name="lock" :size="16" class="mt-0.5 shrink-0 text-primary" /> Please sign in to continue.
          </div>
          <div v-if="error" role="alert" aria-live="assertive" class="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-danger">
            <AppIcon name="warning" :size="16" class="mt-0.5 shrink-0" /> <span>{{ error }}</span>
          </div>

          <div class="space-y-5">
            <!-- Email -->
            <div>
              <label class="label" for="email">Email address</label>
              <div class="relative">
                <AppIcon name="mail" :size="18" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="email" ref="emailEl" v-model="email" class="input h-12 !pl-11" :class="emailError ? '!border-danger' : ''"
                  type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false"
                  placeholder="you@company.com" maxlength="200" required
                  :aria-invalid="!!emailError" aria-describedby="email-err"
                  @blur="touched.email = true"
                />
              </div>
              <p id="email-err" class="mt-1.5 min-h-[1rem] text-xs text-danger">{{ emailError }}</p>
            </div>

            <!-- Password -->
            <div class="-mt-2">
              <label class="label" for="password">Password</label>
              <div class="relative">
                <AppIcon name="lock" :size="18" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="password" ref="passwordEl" v-model="password" class="input h-12 !pl-11 !pr-12"
                  :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Enter your password"
                  maxlength="200" required aria-describedby="caps-hint"
                  @keydown="onKey" @keyup="onKey" @blur="capsLock = false"
                />
                <button
                  type="button" class="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                >
                  <AppIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="18" />
                </button>
              </div>
              <p id="caps-hint" class="mt-1.5 flex min-h-[1rem] items-center gap-1.5 text-xs text-warning">
                <template v-if="capsLock"><AppIcon name="warning" :size="13" /> Caps Lock is on</template>
              </p>
            </div>
          </div>

          <div class="-mt-1 flex items-center justify-between">
            <label class="flex cursor-pointer select-none items-center gap-2 text-sm text-muted">
              <input v-model="remember" type="checkbox" class="h-4 w-4 rounded accent-[var(--primary)]" /> Remember my email
            </label>
            <details class="group relative text-sm">
              <summary class="cursor-pointer list-none font-semibold text-primary hover:underline">Forgot password?</summary>
              <div class="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-line bg-surface p-3 text-xs text-muted shadow-xl">
                For security, passwords are reset by your <b class="text-ink">super admin</b> from Admin → Users. Ask them to set a new one for you.
              </div>
            </details>
          </div>

          <button class="btn btn-primary mt-7 h-12 w-full text-[15px]" :disabled="loading">
            <svg v-if="loading" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity=".3" stroke-width="3" /><path d="M22 12a10 10 0 00-10-10" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
            {{ loading ? 'Signing in…' : 'Sign in' }}
            <AppIcon v-if="!loading" name="chevronRight" :size="18" />
          </button>

          <p class="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <AppIcon name="shield" :size="14" class="text-success" />
            Access is limited to authorised team members.
          </p>
        </form>
      </div>

      <p class="pb-6 text-center text-[11px] text-muted lg:hidden">© {{ year }} Central Leads</p>
    </section>
  </div>
</template>

<style scoped>
.brand {
  background:
    radial-gradient(90% 70% at 100% 0%, color-mix(in srgb, var(--primary-2) 70%, transparent), transparent 60%),
    linear-gradient(150deg, color-mix(in srgb, var(--primary) 78%, #0b0f1a) 0%, color-mix(in srgb, var(--primary) 45%, #0b0f1a) 55%, #0b0f1a 100%);
}
.grid-bg {
  background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse at 30% 40%, #000 30%, transparent 75%);
}
.blob { background: color-mix(in srgb, var(--primary-2) 55%, transparent); filter: blur(80px); }
.blob-2 { background: color-mix(in srgb, var(--primary) 50%, transparent); filter: blur(90px); }
.preview { background: rgba(255, 255, 255, 0.08); box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.5); }
.form-side {
  background: radial-gradient(60% 40% at 100% 0%, color-mix(in srgb, var(--primary) 7%, transparent), transparent 70%), var(--bg);
}
.logo { background: linear-gradient(135deg, var(--primary), var(--primary-2)); }
.shake { animation: shake 0.4s cubic-bezier(.36, .07, .19, .97); }
@keyframes shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(3px); }
  30%, 50%, 70% { transform: translateX(-5px); }
  40%, 60% { transform: translateX(5px); }
}
@media (prefers-reduced-motion: reduce) { .shake { animation: none; } }
/* Short laptop screens: drop the illustration so the story panel never feels cramped. */
@media (max-height: 860px) { .preview { display: none; } }
details > summary::-webkit-details-marker { display: none; }
</style>
