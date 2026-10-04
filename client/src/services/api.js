import axios from 'axios';

// Empty origin = same origin (Vite dev proxy forwards /api and /socket.io to :5000).
// For a separately hosted API set VITE_API_ORIGIN, e.g. https://api.example.com
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || '';

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('payflow_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // The server returns 401 for missing / invalid / expired tokens
    if (error.response && error.response.status === 401) {
      const isAuthCall = /\/auth\/(login|register)$/.test(error.config?.url || '');
      if (!isAuthCall) {
        localStorage.removeItem('payflow_token');
        localStorage.removeItem('payflow_user');
        if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
