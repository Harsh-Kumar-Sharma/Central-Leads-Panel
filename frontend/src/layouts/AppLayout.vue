<script setup>
import { watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore } from '../stores/ui';
import AppSidebar from '../components/AppSidebar.vue';
import AppHeader from '../components/AppHeader.vue';
import ToastStack from '../components/ToastStack.vue';
import { useNotificationsStore } from '../stores/notifications';

const ui = useUiStore();
const route = useRoute();
const notifications = useNotificationsStore();

// Live notifications for the whole logged-in session; closed on logout (layout unmounts).
onMounted(() => notifications.connect());
onBeforeUnmount(() => notifications.disconnect());
// A new lead also changes the sidebar's "new & unread" lead badge.
watch(() => notifications.lastEvent, () => ui.refreshUnread());

// Close the mobile drawer on navigation; refresh the unread badge as the user moves around.
watch(() => route.fullPath, () => { ui.mobileOpen = false; ui.refreshUnread(); });

let timer;
const onVisible = () => { if (document.visibilityState === 'visible') ui.refreshUnread(); };
onMounted(() => {
  ui.refreshUnread();
  timer = setInterval(() => { if (document.visibilityState === 'visible') ui.refreshUnread(); }, 60000);
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); });
</script>

<template>
  <div class="flex min-h-full">
    <a href="#main" class="sr-only z-[60] rounded-lg bg-primary px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="ui.mobileOpen" class="fixed inset-0 z-[35] bg-black/50 backdrop-blur-sm lg:hidden" @click="ui.mobileOpen = false" />
    </Transition>

    <AppSidebar />
    <ToastStack />

    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader />
      <main id="main" class="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6 lg:p-8">
        <RouterView v-slot="{ Component }">
          <Transition mode="out-in" enter-from-class="opacity-0 translate-y-1" enter-active-class="transition duration-200 ease-out" leave-to-class="opacity-0" leave-active-class="transition duration-100">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
