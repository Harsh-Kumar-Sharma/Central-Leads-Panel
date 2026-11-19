import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { setUnauthorizedHandler } from '../api/client';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { guest: true } },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    meta: { auth: true },
    children: [
      { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: 'Dashboard', subtitle: 'Overview of enquiries across your websites', crumbs: ['Overview', 'Dashboard'] } },
      { path: 'leads', name: 'leads', component: () => import('../views/LeadsView.vue'), meta: { title: 'Leads', subtitle: 'Every enquiry and quote request, filtered your way', crumbs: ['Overview', 'Leads'] } },
      { path: 'admin/sites', name: 'admin-sites', component: () => import('../views/AdminSitesView.vue'), meta: { title: 'Sites & API keys', subtitle: 'Websites, their keys and integration code', crumbs: ['Administration', 'Sites'], admin: true } },
      { path: 'admin/users', name: 'admin-users', component: () => import('../views/AdminUsersView.vue'), meta: { title: 'Users & access', subtitle: 'Team members, roles and site access', crumbs: ['Administration', 'Users'], admin: true } },
      { path: 'admin/notifications', name: 'admin-notifications', component: () => import('../views/AdminNotificationsView.vue'), meta: { title: 'Notification settings', subtitle: 'SMTP, recipients and email delivery log', crumbs: ['Administration', 'Notifications'], admin: true } },
      { path: 'account', name: 'account', component: () => import('../views/AccountView.vue'), meta: { title: 'My account', subtitle: 'Your profile and password', crumbs: ['Account', 'My account'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded || (auth.token && !auth.user)) await auth.fetchMe();
  if (to.matched.some((r) => r.meta.auth) && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  if (to.meta.guest && auth.isAuthenticated) return { name: 'dashboard' };
  if (to.meta.admin && !auth.isSuperAdmin) return { name: 'dashboard' };
  document.title = to.meta.title ? `${to.meta.title} · Central Leads` : 'Central Leads Panel';
});

function handleUnauthorized() {
  useAuthStore().logout();
  if (router.currentRoute.value.name !== 'login') router.replace({ name: 'login' });
}
setUnauthorizedHandler(handleUnauthorized);
// The live notification stream (fetch-based, outside axios) reports ended sessions this way.
window.addEventListener('clp:unauthorized', handleUnauthorized);

export default router;
