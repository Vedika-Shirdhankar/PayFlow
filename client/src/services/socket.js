import { io } from 'socket.io-client';
import { API_ORIGIN } from './api';

let socket = null;

// The token is read lazily so reconnects always use the latest JWT.
export const initSocket = () => {
  if (!localStorage.getItem('payflow_token')) return null;

  if (!socket) {
    socket = io(API_ORIGIN || undefined, {
      autoConnect: true,
      reconnectionAttempts: 10,
      auth: (cb) => cb({ token: localStorage.getItem('payflow_token') }),
    });

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected to server socket:', socket.id);
    });
    socket.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection error:', err.message);
    });
  }
  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
