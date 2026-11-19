import axios from 'axios';

const TOKEN_KEY = 'clp-token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 20000,
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  const t = tokenStore.get();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const isLogin = /\/auth\/(login|logout)/.test(err.config?.url || '');
    if (err.response?.status === 401 && !isLogin && onUnauthorized) onUnauthorized();
    return Promise.reject(err);
  }
);

export const errorMessage = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.message || (err?.code === 'ECONNABORTED' ? 'Request timed out' : fallback);

export default api;
