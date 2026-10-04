import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';
import usePaymentEvents from '../hooks/usePaymentEvents';
import {
  ArrowLeft, GitCommit, Clock, AlertCircle, RefreshCw,
  Tag, MessageSquare, RotateCcw, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';

const TAG_COLORS = {
  College: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Travel: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Food: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Essentials: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  Bills: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  Gift: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  Business: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Refund: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
};
const getTagColor = (tag) => TAG_COLORS[tag] || 'bg-slate-700 text-slate-300 border-slate-600';

const REFUND_STATUS_STYLES = {
  PENDING:    'bg-amber-500/15 text-amber-300 border-amber-500/30',
  APPROVED:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  REJECTED:   'bg-rose-500/15 text-rose-400 border-rose-500/30',
  PROCESSING: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  COMPLETED:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const PaymentDetailsPage = () => {
  const { paymentId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Refund state
  const [refund, setRefund] = useState(null);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundMsg, setRefundMsg] = useState('');
  const [refundErr, setRefundErr] = useState('');

  const fetchDetails = async () => {
    try {
      const [payRes, refundRes] = await Promise.allSettled([
        api.get(`/payments/${paymentId}`),
        api.get(`/payments/${paymentId}/refund`),
      ]);
      if (payRes.status === 'fulfilled') setData(payRes.value.data);
      else setError(payRes.reason?.response?.data?.error || 'Failed to load payment details');
      if (refundRes.status === 'fulfilled') setRefund(refundRes.value.data.refund);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load payment details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 8000);
    return () => clearInterval(interval);
  }, [paymentId]);

  usePaymentEvents(() => fetchDetails(), paymentId);

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    setRefundErr('');
    setRefundMsg('');
    if (!refundReason.trim()) { setRefundErr('Please provide a reason for the refund.'); return; }
    setRefundSubmitting(true);
    try {
      const payload = { reason: refundReason };
      const amt = Number(refundAmount);
      if (refundAmount && amt > 0) payload.amount = amt;
      await api.post(`/payments/${paymentId}/refund`, payload);
      setRefundMsg('✅ Refund request submitted! Awaiting admin review.');
      setShowRefundForm(false);
      setRefundReason('');
      setRefundAmount('');
      fetchDetails();
    } catch (err) {
      setRefundErr(err.response?.data?.error || 'Failed to submit refund request.');
    } finally {
      setRefundSubmitting(false);
    }
  };

  if (loading) return <div className="text-center py-16 text-slate-500 font-mono text-xs">Loading payment details…</div>;

  if (error || !data) {
    return (
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
        <div className="text-rose-400 font-semibold text-sm">{error || 'Payment not found'}</div>
        <Link to="/payments" className="inline-block text-xs text-blue-400 hover:underline">Back to Payments</Link>
      </div>
    );
  }

  const { payment, job, transactions } = data;
  const isSender = payment.senderId?._id === user?.id || payment.senderId?._id?.toString() === user?.id;
  const canRequestRefund = isSender && payment.status === 'SUCCESS' && (!refund || refund.status === 'REJECTED');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <Link to="/payments" className="text-xs font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back to History
        </Link>
        <Link
          to={`/payments/${paymentId}/trace`}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20"
        >
          <GitCommit className="w-4 h-4 text-cyan-300" /> Open PayFlow Trace
        </Link>
      </div>

      {/* Refund success message */}
      {refundMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm rounded-2xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" /> {refundMsg}
        </div>
      )}

      {/* Main Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="text-xs font-mono text-slate-400 mb-1">Payment ID</div>
            <div className="text-lg font-mono font-bold text-white tracking-tight break-all">{payment._id}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusBadge status={payment.status} className="text-sm px-3 py-1.5" />
            {refund && (
              <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold font-mono ${REFUND_STATUS_STYLES[refund.status] || 'bg-slate-700 text-slate-300'}`}>
                Refund: {refund.status}
              </span>
            )}
            <button onClick={fetchDetails} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Overview Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500 mb-1">Amount</div>
            <div className="text-xl font-bold text-white">${payment.amount.toFixed(2)}</div>
            <div className="text-slate-500 mt-0.5">{payment.currency}</div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500 mb-1">Idempotency Key</div>
            <div className="text-cyan-300 font-semibold truncate text-[11px]" title={payment.idempotencyKey}>{payment.idempotencyKey}</div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500 mb-1">Attempts</div>
            <div className="text-amber-400 font-bold text-xl">{payment.attempts} / {job?.maxAttempts || 3}</div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500 mb-1">Worker</div>
            <div className="text-purple-300 font-semibold truncate text-[11px]">{job?.lockedBy || 'Released'}</div>
          </div>
        </div>

        {/* Note & Tags */}
        {(payment.note || (payment.tags && payment.tags.length > 0)) && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            {payment.note && (
              <div className="flex items-start gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Note</div>
                  <div className="text-slate-200 text-sm">{payment.note}</div>
                </div>
              </div>
            )}
            {payment.tags && payment.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag className="w-4 h-4 text-cyan-400 shrink-0" />
                {payment.tags.map((tag) => (
                  <span key={tag} className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${getTagColor(tag)}`}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Parties */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Sender</span>
            <div className="text-slate-200 font-bold">{payment.senderId?.name}</div>
            <div className="text-slate-400">{payment.senderId?.email}</div>
          </div>
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Recipient</span>
            <div className="text-slate-200 font-bold">{payment.recipientId?.name}</div>
            <div className="text-slate-400">{payment.recipientId?.email}</div>
          </div>
        </div>

        {/* Ledger Transactions */}
        <div className="border-t border-slate-800 pt-6">
          <h3 className="text-sm font-bold text-white mb-3">Committed Ledger Transactions</h3>
          {transactions.length === 0 ? (
            <div className="p-4 bg-slate-950 rounded-xl text-slate-500 font-mono text-xs text-center">
              No ledger transactions committed yet (job pending in queue).
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {transactions.map((t) => (
                <div key={t._id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <span className={`px-2 py-0.5 rounded font-bold mr-2 ${t.type === 'DEBIT' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      {t.type}
                    </span>
                    <span className="text-slate-300">{t.reference}</span>
                  </div>
                  <div className="text-white font-bold">${t.amount.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Refund Section ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-teal-400" /> Refund Management
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {payment.status === 'SUCCESS' ? 'Request a full or partial refund for this payment.' : 'Refunds can only be requested on completed payments.'}
            </p>
          </div>

          {canRequestRefund && (
            <button
              onClick={() => setShowRefundForm((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/40 text-teal-300 rounded-xl text-xs font-bold transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {showRefundForm ? 'Cancel' : 'Request Refund'}
              {showRefundForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Existing Refund Status */}
        {refund && (
          <div className={`p-4 rounded-xl border space-y-3 ${REFUND_STATUS_STYLES[refund.status] || 'border-slate-700'}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold">Refund Request</div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${REFUND_STATUS_STYLES[refund.status]}`}>{refund.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div><span className="text-slate-500">Amount: </span><strong>${refund.amount?.toFixed(2)}</strong></div>
              <div><span className="text-slate-500">Requested: </span><strong>{new Date(refund.createdAt).toLocaleString()}</strong></div>
              {refund.reason && <div className="col-span-2"><span className="text-slate-500">Reason: </span>{refund.reason}</div>}
              {refund.adminNote && <div className="col-span-2"><span className="text-slate-500">Admin note: </span>{refund.adminNote}</div>}
            </div>
          </div>
        )}

        {/* Refund Request Form */}
        {showRefundForm && (
          <form onSubmit={handleRefundSubmit} className="space-y-4 pt-2 border-t border-slate-800">
            {refundErr && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {refundErr}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Refund Amount ($ USD)
              </label>
              <div className="flex items-center gap-2 font-mono text-xs text-slate-400 mb-2">
                <span>Original payment: <strong className="text-white">${payment.amount.toFixed(2)}</strong></span>
                <button
                  type="button"
                  onClick={() => setRefundAmount(String(payment.amount))}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-[11px]"
                >
                  Full refund
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-500 font-bold">$</span>
                <input
                  type="number" min="0.01" step="0.01" max={payment.amount}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder={`Up to $${payment.amount.toFixed(2)}`}
                  className="w-full pl-8 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Reason *</label>
              <textarea
                required maxLength={500}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Explain why you are requesting a refund…"
                rows={3}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500 resize-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">{refundReason.length}/500</p>
            </div>

            <button
              type="submit"
              disabled={refundSubmitting}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {refundSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {refundSubmitting ? 'Submitting…' : 'Submit Refund Request'}
            </button>
          </form>
        )}

        {payment.status !== 'SUCCESS' && !refund && (
          <div className="text-xs text-slate-500 font-mono italic">
            This payment has not completed — no refund is available.
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentDetailsPage;
