import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { initSocket, disconnectSocket } from '../services/socket';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('payflow_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
      setWallet(res.data.wallet);
      localStorage.setItem('payflow_user', JSON.stringify(res.data.user));
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      const status = err.response?.status;
      const code = err.response?.data?.code;
      const isGenuineAuthFailure =
        status === 401 && (code === 'TOKEN_INVALID' || code === 'USER_NOT_FOUND');

      if (isGenuineAuthFailure) {
        setUser(null);
        setWallet(null);
        localStorage.removeItem('payflow_token');
        localStorage.removeItem('payflow_user');
        disconnectSocket();
      } else {
        // Network drop or DB outage: keep saved user in state so session remains active
        console.warn('Network or DB error during profile fetch; preserving offline session state.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('payflow_token');
    if (token) {
      fetchProfile();
      initSocket();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, user: userData, wallet: walletData } = res.data;
    localStorage.setItem('payflow_token', token);
    localStorage.setItem('payflow_user', JSON.stringify(userData));
    setUser(userData);
    setWallet(walletData);
    initSocket();
    return res.data;
  };

  const register = async (name, email, password) => {
    const res = await api.post('/auth/register', { name, email, password });
    const { token, user: userData, wallet: walletData } = res.data;
    localStorage.setItem('payflow_token', token);
    localStorage.setItem('payflow_user', JSON.stringify(userData));
    setUser(userData);
    setWallet(walletData);
    initSocket();
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('payflow_token');
    localStorage.removeItem('payflow_user');
    setUser(null);
    setWallet(null);
    disconnectSocket();
  };

  const refreshWallet = async () => {
    try {
      const res = await api.get('/wallet');
      setWallet(res.data);
    } catch (err) {
      console.error('Error refreshing wallet:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        loading,
        login,
        register,
        logout,
        refreshWallet,
        fetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
