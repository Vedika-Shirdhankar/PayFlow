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
    const status = error.response?.status;
    const code = error.response?.data?.code;

    // A 401 is only a genuine session termination event when the server
    // says the token itself is bad or missing (TOKEN_INVALID, USER_NOT_FOUND).
    // A 503 with AUTH_DB_UNAVAILABLE means the DB is down — do NOT clear the token.
    const isGenuineAuthFailure =
      status === 401 &&
      (code === 'TOKEN_INVALID' || code === 'USER_NOT_FOUND');

    const isAuthEndpoint = /\/auth\/(login|register)$/.test(error.config?.url || '');

    if (isGenuineAuthFailure && !isAuthEndpoint) {
      localStorage.removeItem('payflow_token');
      localStorage.removeItem('payflow_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    }

    // Enrich the error with a user-friendly message for UI display
    if (!error.response || error.code === 'ERR_NETWORK' || !navigator.onLine) {
      error.userMessage = 'Network Error: You appear to be offline or server is unreachable. Please check your internet connection and try again.';
    } else if (status === 503 && code === 'AUTH_DB_UNAVAILABLE') {
      error.userMessage = 'Server is temporarily unavailable (Database offline). Please check your connection and try again in a moment.';
    } else if (status >= 500) {
      error.userMessage = error.response?.data?.error || 'Server error. Please try again.';
    }

    return Promise.reject(error);
  }
);

export default api;

