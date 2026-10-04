import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Filter, Gauge, Save, X } from 'lucide-react';

const WalletPage = () => {
  const { wallet, refreshWallet } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('ALL');

  // Limits
  const [limits, setLimits] = useState({ perPaymentLimit: 0, dailyLimit: 0 });
  const [editingLimits, setEditingLimits] = useState(false);
  const [draftLimits, setDraftLimits] = useState({ perPaymentLimit: '', dailyLimit: '' });
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitsMsg, setLimitsMsg] = useState('');

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      await refreshWallet();
      const [txRes, limRes] = await Promise.allSettled([
        api.get('/wallet/transactions'),
        api.get('/users/me/limits'),
      ]);
      if (txRes.status === 'fulfilled') setTransactions(txRes.value.data || []);
      if (limRes.status === 'fulfilled') setLimits(limRes.value.data);
    } catch (err) {
      console.error('Error fetching wallet data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTransactions(); }, []);

  const handleEditLimits = () => {
    setDraftLimits({ perPaymentLimit: limits.perPaymentLimit || '', dailyLimit: limits.dailyLimit || '' });
    setEditingLimits(true);
  };

  const handleSaveLimits = async () => {
    setSavingLimits(true);
    setLimitsMsg('');
    try {
      const res = await api.put('/users/me/limits', {
        perPaymentLimit: draftLimits.perPaymentLimit === '' ? 0 : Number(draftLimits.perPaymentLimit),
        dailyLimit: draftLimits.dailyLimit === '' ? 0 : Number(draftLimits.dailyLimit),
      });
      setLimits(res.data);
      setLimitsMsg('✅ Limits saved!');
      setEditingLimits(false);
      setTimeout(() => setLimitsMsg(''), 3000);
    } catch (err) {
      setLimitsMsg('❌ ' + (err.response?.data?.error || 'Failed to save'));
    } finally {
      setSavingLimits(false);
    }
  };

  const filtered = transactions.filter((t) => filterType === 'ALL' || t.type === filterType);

  return (
    <div className="space-y-6">
      {/* Wallet Balance Hero Card */}
      <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/20 rounded-2xl p-6 lg:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-emerald-400 mb-2">
            <Wallet className="w-4 h-4" />
            <span>Digital Ledger Wallet</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            ${(wallet?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-mono">
            Wallet Currency: {wallet?.currency || 'USD'} | Account ID: {wallet?.userId}
          </p>
        </div>

        <button
          onClick={fetchTransactions}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh Balance
        </button>
      </div>

      {/* Transaction Limits Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Gauge className="w-5 h-5 text-amber-400" /> Transaction Limits
            </h2>
            <p className="text-xs text-slate-300 mt-1 font-medium">Set optional spending controls. Use 0 to disable a limit.</p>
          </div>
          {limitsMsg && <span className="text-xs font-mono font-bold text-emerald-300">{limitsMsg}</span>}
          {!editingLimits && (
            <button
              onClick={handleEditLimits}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-colors"
            >
              Edit Limits
            </button>
          )}
        </div>

        {!editingLimits ? (
          <div className="grid grid-cols-2 gap-4 font-mono text-xs">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-300 font-semibold mb-1">Per-Payment Limit</div>
              <div className="text-2xl font-extrabold text-amber-300">
                {limits.perPaymentLimit > 0 ? `$${limits.perPaymentLimit.toFixed(2)}` : <span className="text-slate-400 text-sm font-medium">No limit set</span>}
              </div>
              <div className="text-slate-400 text-xs mt-1 font-medium">Max per single payment</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-300 font-semibold mb-1">Daily Limit</div>
              <div className="text-2xl font-extrabold text-purple-300">
                {limits.dailyLimit > 0 ? `$${limits.dailyLimit.toFixed(2)}` : <span className="text-slate-400 text-sm font-medium">No limit set</span>}
              </div>
              <div className="text-slate-400 text-xs mt-1 font-medium">Max outgoing per calendar day</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 font-mono text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-xs">Per-Payment Limit ($)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={draftLimits.perPaymentLimit}
                    onChange={(e) => setDraftLimits((d) => ({ ...d, perPaymentLimit: e.target.value }))}
                    placeholder="0 = no limit"
                    className="w-full pl-7 pr-3 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-xs">Daily Limit ($)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={draftLimits.dailyLimit}
                    onChange={(e) => setDraftLimits((d) => ({ ...d, dailyLimit: e.target.value }))}
                    placeholder="0 = no limit"
                    className="w-full pl-7 pr-3 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white font-bold focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveLimits}
                disabled={savingLimits}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {savingLimits ? 'Saving…' : 'Save Limits'}
              </button>
              <button
                onClick={() => { setEditingLimits(false); setLimitsMsg(''); }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
            <p className="text-xs text-slate-400 font-mono font-medium">Enter 0 in any field to remove that limit.</p>
          </div>
        )}
      </div>

      {/* Transaction History Section */}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">Wallet Transaction History</h2>
            <p className="text-xs text-slate-400">Atomic DEBIT and CREDIT records in MongoDB</p>
          </div>

          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-mono">
            <Filter className="w-3.5 h-3.5 text-slate-500 ml-2" />
            {['ALL', 'DEBIT', 'CREDIT'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  filterType === type
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-500 font-mono text-xs">
            Loading ledger transaction history...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500 font-mono text-xs">
            No {filterType !== 'ALL' ? filterType : ''} transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono font-semibold">
                  <th className="pb-3 px-3">Reference ID</th>
                  <th className="pb-3 px-3">Type</th>
                  <th className="pb-3 px-3">Sender</th>
                  <th className="pb-3 px-3">Recipient</th>
                  <th className="pb-3 px-3">Amount</th>
                  <th className="pb-3 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filtered.map((t) => {
                  const isDebit = t.type === 'DEBIT';
                  return (
                    <tr key={t._id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-3 font-semibold text-slate-300">
                        {t.reference}
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${
                            isDebit
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          }`}
                        >
                          {isDebit ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                          {t.type}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-300">{t.senderId?.name || t.senderId}</td>
                      <td className="py-3.5 px-3 text-slate-300">{t.recipientId?.name || t.recipientId}</td>
                      <td className={`py-3.5 px-3 font-bold ${isDebit ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {isDebit ? '-' : '+'}${t.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-400 text-[11px]">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletPage;
