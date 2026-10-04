import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Wallet,
  Send,
  History,
  GitCommit,
  ShieldAlert,
  FileText,
  Network,
  RotateCcw,
} from 'lucide-react';

const Sidebar = () => {
  const { user } = useAuth();

  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/wallet', label: 'My Wallet', icon: Wallet },
    { to: '/send', label: 'Send Payment', icon: Send },
    { to: '/payments', label: 'Payment History', icon: History },
    { to: '/refunds', label: 'My Refunds', icon: RotateCcw },
  ];

  const adminLinks = [
    { to: '/admin', label: 'Admin Dashboard', icon: ShieldAlert },
    { to: '/admin/topology', label: 'System Topology', icon: Network },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: FileText },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col justify-between shrink-0 min-h-[calc(100vh-65px)]">
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono font-bold uppercase text-slate-300 tracking-wider px-3 mb-2">
            User Workspace
          </div>
          <nav className="space-y-1">
            {links.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                      isActive
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 shadow-md shadow-blue-500/10'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 text-blue-400" />
                  <span>{link.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {user?.role === 'ADMIN' && (
          <div>
            <div className="text-xs font-mono font-bold uppercase text-purple-300 tracking-wider px-3 mb-2 flex items-center justify-between">
              <span>Admin System</span>
              <span className="text-[10px] bg-purple-500/20 text-purple-200 px-2 py-0.5 rounded border border-purple-500/40 font-bold">
                PRO
              </span>
            </div>
            <nav className="space-y-1">
              {adminLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                        isActive
                          ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 shadow-md shadow-purple-500/10'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-purple-400" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-xs">
        <div className="flex items-center gap-2 font-mono text-slate-200 font-bold mb-1">
          <GitCommit className="w-4 h-4 text-cyan-400" />
          <span>MongoDB Queue Engine</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed font-medium">
          Payments enqueued as <code className="text-amber-300 bg-amber-500/10 px-1 py-0.5 rounded font-mono">QUEUED</code> & claimed by process worker with atomic transactions.
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
