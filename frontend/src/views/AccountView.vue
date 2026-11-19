<script setup>
import { ref, reactive, onMounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import api, { tokenStore, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useNotificationsStore } from '../stores/notifications';
import NotificationSettings from '../components/NotificationSettings.vue';

const auth = useAuthStore();
const notifications = useNotificationsStore();
const route = useRoute();

// /account#notifications (from the bell and user menu) jumps to the notification settings.
async function scrollToHash() {
  if (route.hash !== '#notifications') return;
  await nextTick();
  setTimeout(() => document.getElementById('notifications')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}
onMounted(scrollToHash);
watch(() => route.hash, scrollToHash);
const form = reactive({ current_password: '', new_password: '', confirm: '' });
const errors = ref({});
const message = ref('');
const error = ref('');
const saving = ref(false);

async function submit() {
  errors.value = {};
  message.value = '';
  error.value = '';
  if (form.new_password.length < 8) { errors.value.new_password = 'Password must be at least 8 characters'; return; }
  if (form.new_password !== form.confirm) { errors.value.confirm = 'Passwords do not match'; return; }
  saving.value = true;
  try {
    const { data } = await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password });
    // Server rotates the session: other devices are signed out, this one gets a fresh token.
    tokenStore.set(data.token);
    auth.token = data.token;
    notifications.reconnect(); // the old stream's token is no longer valid
    Object.assign(form, { current_password: '', new_password: '', confirm: '' });
    message.value = 'Password changed. Other sessions have been signed out.';
  } catch (e) {
    const errs = e?.response?.data?.errors;
    if (errs) errors.value = errs;
    else error.value = errorMessage(e, 'Could not change password');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <div class="card p-5">
      <h2 class="font-semibold">Profile</h2>
      <dl class="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt class="text-muted">Name</dt><dd>{{ auth.user?.name }}</dd>
        <dt class="text-muted">Email</dt><dd>{{ auth.user?.email }}</dd>
        <dt class="text-muted">Role</dt><dd class="capitalize">{{ auth.user?.role?.replace('_', ' ') }}</dd>
      </dl>
    </div>

    <form class="card space-y-4 p-5" novalidate @submit.prevent="submit">
      <h2 class="font-semibold">Change password</h2>
      <div v-if="message" class="rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{{ message }}</div>
      <div v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ error }}</div>
      <div>
        <label class="label" for="cp-cur">Current password</label>
        <input id="cp-cur" v-model="form.current_password" class="input" type="password" autocomplete="current-password" maxlength="200" />
        <p v-if="errors.current_password" class="mt-1 text-xs text-danger">{{ errors.current_password }}</p>
      </div>
      <div>
        <label class="label" for="cp-new">New password</label>
        <input id="cp-new" v-model="form.new_password" class="input" type="password" autocomplete="new-password" minlength="8" maxlength="200" />
        <p v-if="errors.new_password" class="mt-1 text-xs text-danger">{{ errors.new_password }}</p>
      </div>
      <div>
        <label class="label" for="cp-confirm">Confirm new password</label>
        <input id="cp-confirm" v-model="form.confirm" class="input" type="password" autocomplete="new-password" maxlength="200" />
        <p v-if="errors.confirm" class="mt-1 text-xs text-danger">{{ errors.confirm }}</p>
      </div>
      <div class="flex justify-end">
        <button class="btn btn-primary" :disabled="saving || !form.current_password || !form.new_password">{{ saving ? 'Saving…' : 'Change password' }}</button>
      </div>
    </form>

    <NotificationSettings />
  </div>
</template>
