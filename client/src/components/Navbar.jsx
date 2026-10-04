import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, Wallet as WalletIcon, LogOut, Cpu, Activity, User as UserIcon, WifiOff } from 'lucide-react';
import api from '../services/api';

const Navbar = () => {
  const { user, wallet, logout } = useAuth();
  const [queueInfo, setQueueInfo] = useState({ queued: 0, processing: 0, workers: 0 });
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchQueueSummary = async () => {
    try {
      if (user?.role === 'ADMIN') {
        const res = await api.get('/admin/queue-health');
        setQueueInfo({
          queued: res.data.queuedCount,
          processing: res.data.processingCount,
          workers: res.data.activeWorkerCount,
        });
      }
    } catch (e) {
      // quiet catch
    }
  };

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      fetchQueueSummary();
      const interval = setInterval(fetchQueueSummary, 5000);
      return () => clearInterval(interval);
    }
  }, [user]);

  return (
    <>
      {isOffline && (
        <div className="bg-rose-600 text-white font-mono text-xs py-2 px-4 text-center flex items-center justify-center gap-2 shadow-lg animate-pulse z-50">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Network Error: You are currently offline. Please check your internet connection. Queued transactions will process automatically when reconnected.</span>
        </div>
      )}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3.5 flex items-center justify-between">
      {/* Brand Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 p-0.5 shadow-lg shadow-blue-500/20">
          <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              PAYFLOW
            </span>
            <span className="text-xs font-mono uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
              Distributed Queue MVP
            </span>
          </div>
          <p className="text-xs text-slate-300 font-mono font-medium">MongoDB Queue & Process Workers</p>
        </div>
      </div>

      {/* Center Status Indicators */}
      {user && (
        <div className="hidden md:flex items-center gap-4 bg-slate-950/80 border border-slate-700/60 rounded-xl px-4 py-2">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-slate-300 font-medium">Queue Storage:</span>
            <span className="font-bold text-emerald-400">MongoDB Atlas</span>
          </div>
          {user.role === 'ADMIN' && (
            <div className="flex items-center gap-3 border-l border-slate-700/60 pl-4 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                <Activity className="w-3.5 h-3.5" />
                <span>Queued: <strong className="text-amber-200">{queueInfo.queued}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-blue-300 font-semibold">
                <span>Processing: <strong className="text-blue-200">{queueInfo.processing}</strong></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Right User Controls */}
      {user ? (
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded-lg px-3.5 py-1.5">
            <WalletIcon className="w-4 h-4 text-emerald-400" />
            <div className="text-xs">
              <div className="text-slate-300 font-semibold">Balance</div>
              <div className="font-mono font-extrabold text-emerald-400 text-sm">
                ${(wallet?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} {wallet?.currency || 'USD'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-100 flex items-center gap-1 justify-end">
                {user.name}
                {user.role === 'ADMIN' && (
                  <span className="bg-purple-500/20 text-purple-200 border border-purple-500/40 text-xs px-2 py-0.5 rounded font-mono font-bold">
                    ADMIN
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-300 font-mono font-medium">{user.email}</div>
            </div>

            <button
              onClick={logout}
              title="Logout"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs font-mono text-slate-400">Fault-Tolerant Payment Engine</div>
      )}
    </header>
    </>
  );
};

export default Navbar;
