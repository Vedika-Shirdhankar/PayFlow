import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Send, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck, Zap,
  Users, Loader2, Clock, Tag, MessageSquare, X, Info, Gauge,
} from 'lucide-react';

const PRESET_TAGS = ['College', 'Travel', 'Food', 'Essentials', 'Bills', 'Gift', 'Business'];

const TAG_COLORS = {
  College: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Travel: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Food: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Essentials: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Bills: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  Gift: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  Business: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

const getTagColor = (tag) =>
  TAG_COLORS[tag] || 'bg-slate-700 text-slate-300 border-slate-600';

const SendPaymentPage = () => {
  const { user, wallet, refreshWallet } = useAuth();
  const navigate = useNavigate();

  const [recipients, setRecipients] = useState([]);
  const [recipientId, setRecipientId] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [recipientsError, setRecipientsError] = useState('');

  const [amount, setAmount] = useState('50');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [note, setNote] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState('');

  const [limits, setLimits] = useState({ perPaymentLimit: 0, dailyLimit: 0 });
  const [dailyUsed, setDailyUsed] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [responseInfo, setResponseInfo] = useState(null);
  const [error, setError] = useState('');

  const currentBalance = wallet?.balance ?? 0;
  const numAmount = Number(amount);

  const dailyRemaining = limits.dailyLimit > 0 ? limits.dailyLimit - dailyUsed : null;

  let amountError = '';
  if (!amount || isNaN(numAmount) || numAmount <= 0) {
    amountError = 'Enter a valid payment amount.';
  } else if (numAmount > currentBalance) {
    amountError = `Insufficient balance. You can send up to $${currentBalance.toFixed(2)}.`;
  } else if (limits.perPaymentLimit > 0 && numAmount > limits.perPaymentLimit) {
    amountError = `Exceeds your per-payment limit of $${limits.perPaymentLimit.toFixed(2)}.`;
  } else if (dailyRemaining !== null && numAmount > dailyRemaining) {
    amountError = `Exceeds daily budget. You have $${dailyRemaining.toFixed(2)} remaining today.`;
  }

  const isSubmitDisabled =
    submitting || loadingRecipients || recipients.length === 0 || !recipientId || Boolean(amountError);

  const generateIdempotencyKey = () => {
    const key = `KEY-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    setIdempotencyKey(key);
    return key;
  };

  useEffect(() => {
    generateIdempotencyKey();
    fetchRecipients();
    fetchLimits();
    if (refreshWallet) refreshWallet();
  }, []);

  const fetchRecipients = async () => {
    setLoadingRecipients(true);
    setRecipientsError('');
    try {
      const res = await api.get('/users/recipients');
      const data = res.data || [];
      setRecipients(data);
      if (data.length > 0) setRecipientId(data[0].id || data[0]._id);
    } catch (err) {
      setRecipientsError(err.response?.data?.error || 'Failed to load recipients.');
    } finally {
      setLoadingRecipients(false);
    }
  };

  const fetchLimits = async () => {
    try {
      const res = await api.get('/users/me/limits');
      setLimits(res.data);
      // Also compute today's usage
      if (res.data.dailyLimit > 0) {
        const hist = await api.get('/payments?limit=100');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const used = (hist.data.payments || [])
          .filter(p => new Date(p.createdAt) >= today && ['SUCCESS','QUEUED','PROCESSING'].includes(p.status))
          .reduce((sum, p) => sum + p.amount, 0);
        setDailyUsed(used);
      }
    } catch {}
  };

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length < 5 ? [...prev, tag] : prev
    );
  };

  const addCustomTag = () => {
    const t = customTag.trim().substring(0, 30);
    if (t && !selectedTags.includes(t) && selectedTags.length < 5) {
      setSelectedTags((prev) => [...prev, t]);
      setCustomTag('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResponseInfo(null);
    if (amountError || !recipientId) { setError(amountError || 'Please select a recipient.'); return; }

    setSubmitting(true);
    try {
      const res = await api.post('/payments', {
        recipientId,
        amount: Number(amount),
        idempotencyKey,
        note: note.trim() || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      setResponseInfo(res.data);
      if (refreshWallet) refreshWallet();
      setTimeout(() => navigate(`/payments/${res.data.paymentId}/trace`), 1800);
    } catch (err) {
      const errMsg =
        err.response?.data?.message === 'Insufficient balance'
          ? `Insufficient balance. Available: $${(err.response?.data?.availableBalance ?? 0).toFixed(2)}`
          : err.response?.data?.error || err.userMessage || 'Failed to submit payment — check connection.';
      setError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">Send Money</h1>
        <p className="text-slate-300 text-sm mt-1 font-medium">
          Payments are validated by the API and processed asynchronously by a dedicated worker.
        </p>
      </div>

      {/* Architecture Banner */}
      <div className="bg-blue-950/50 border border-blue-500/30 rounded-2xl p-4 text-xs space-y-2 shadow-lg">
        <div className="flex items-center gap-2 font-mono font-bold text-blue-300 text-sm">
          <Zap className="w-4.5 h-4.5 text-cyan-400" />
          <span>Producer-Consumer Queue Architecture</span>
        </div>
        <p className="text-slate-200 leading-relaxed font-medium">
          1. API validates, checks balance & limits, returns <code className="text-emerald-300 font-bold bg-emerald-500/20 px-1.5 py-0.5 rounded">HTTP 202</code>.{' '}
          2. Worker claims job atomically &amp; executes MongoDB session transaction.
        </p>
      </div>

      {/* Limits Info Row */}
      {(limits.perPaymentLimit > 0 || limits.dailyLimit > 0) && (
        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          {limits.perPaymentLimit > 0 && (
            <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3.5 flex items-center gap-3">
              <Gauge className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <div className="text-slate-300 font-semibold">Per-Payment Limit</div>
                <div className="text-amber-300 font-extrabold text-sm">${limits.perPaymentLimit.toFixed(2)}</div>
              </div>
            </div>
          )}
          {limits.dailyLimit > 0 && (
            <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3.5 flex items-center gap-3">
              <Gauge className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <div className="text-slate-300 font-semibold">Daily Remaining</div>
                <div className={`font-extrabold text-sm ${(dailyRemaining ?? 0) < 100 ? 'text-rose-400' : 'text-purple-300'}`}>
                  ${(dailyRemaining ?? 0).toFixed(2)} / ${limits.dailyLimit.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 lg:p-8 shadow-xl space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-3 font-medium">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <div>{error}</div>
          </div>
        )}

        {responseInfo && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-2 font-mono">
            <div className="flex items-center gap-2 font-bold text-amber-300 text-sm">
              <Clock className="w-5 h-5 text-amber-400" />
              <span>{responseInfo.message}</span>
            </div>
            <div>HTTP Response: <strong className="text-emerald-300">202 Accepted</strong></div>
            <div>Payment ID: <strong className="text-slate-200">{responseInfo.paymentId}</strong></div>
            <div>Status: <span className="text-amber-300 font-bold">{responseInfo.status}</span></div>
            {responseInfo.isDuplicate && (
              <div className="p-2 bg-cyan-500/20 text-cyan-200 rounded border border-cyan-500/30">
                🛡️ <strong>Idempotency Match:</strong> Duplicate returned existing record.
              </div>
            )}
            <div className="text-slate-300 font-sans font-medium">Opening PayFlow Trace…</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Recipient */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-400" /> Select Recipient
            </label>
            {loadingRecipients ? (
              <div className="w-full py-3 px-4 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 text-xs font-mono flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" /> Loading recipients…
              </div>
            ) : recipientsError ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs flex items-center justify-between">
                <span>{recipientsError}</span>
                <button type="button" onClick={fetchRecipients} className="px-2.5 py-1 bg-rose-500/20 rounded text-xs font-bold">Retry</button>
              </div>
            ) : recipients.length === 0 ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs font-medium">No other registered users found.</div>
            ) : (
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-white font-semibold text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              >
                {recipients.map((u) => (
                  <option key={u.id || u._id} value={u.id || u._id}>{u.name} — {u.email}</option>
                ))}
              </select>
            )}
          </div>

          {/* Amount */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Amount ($ USD)</label>
              <span className="text-xs text-slate-300 font-mono">
                Balance: <strong className="text-emerald-400 text-sm">${currentBalance.toFixed(2)}</strong>
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-3 text-slate-400 font-mono font-bold text-lg">$</span>
              <input
                type="number" min="0.01" step="0.01" required value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full pl-9 pr-4 py-3 bg-slate-950 border rounded-xl text-white font-mono font-bold text-lg focus:outline-none transition-colors ${amountError ? 'border-rose-500/80 focus:border-rose-500' : 'border-slate-700/80 focus:border-blue-500'}`}
              />
            </div>
            {amountError && (
              <p className="text-xs text-rose-400 mt-1.5 flex items-center gap-1 font-mono font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {amountError}
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-indigo-400" /> Note (Optional)
            </label>
            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='e.g. "Birthday gift", "Rent for October"…'
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder-slate-400 font-medium"
            />
            <p className="text-xs text-slate-400 mt-1 font-medium">{note.length}/200 characters</p>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-cyan-400" /> Tags (Optional, max 5)
            </label>
            {/* Preset chips */}
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 rounded-full border text-xs font-semibold transition-all ${
                    selectedTags.includes(tag)
                      ? getTagColor(tag)
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                maxLength={30}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
                placeholder="Custom tag… (press Enter)"
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!customTag.trim() || selectedTags.length >= 5}
                className="px-3 py-2 bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-bold hover:bg-cyan-600/30 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {/* Selected tags */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedTags.map((tag) => (
                  <span key={tag} className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${getTagColor(tag)}`}>
                    {tag}
                    <button type="button" onClick={() => setSelectedTags((p) => p.filter((t) => t !== tag))} className="hover:text-white ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Idempotency Key */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-cyan-400" /> Idempotency Key
              </label>
              <button type="button" onClick={generateIdempotencyKey} className="text-xs font-mono text-cyan-400 hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> New Key
              </button>
            </div>
            <input
              type="text" required value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">Same key = one payment. Duplicate requests return the original result safely.</p>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Enqueueing Job…' : 'Submit Payment (HTTP 202)'}
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SendPaymentPage;
