import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { RotateCcw, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

const STATUS_STYLES = {
  PENDING:    { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',   icon: <Clock className="w-4 h-4 text-amber-400" />,       label: 'Awaiting Review' },
  APPROVED:   { bg: 'bg-blue-500/15 border-blue-500/30 text-blue-300',      icon: <CheckCircle2 className="w-4 h-4 text-blue-400" />,  label: 'Approved' },
  REJECTED:   { bg: 'bg-rose-500/15 border-rose-500/30 text-rose-300',      icon: <XCircle className="w-4 h-4 text-rose-400" />,       label: 'Rejected' },
  PROCESSING: { bg: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',      icon: <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />, label: 'Processing' },
  COMPLETED:  { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, label: 'Completed' },
};

const StatusTimeline = ({ status }) => {
  const steps = ['PENDING', 'APPROVED', 'COMPLETED'];
  const rejectedAt = status === 'REJECTED' ? 1 : -1;
  const currentIdx = steps.indexOf(status);
  const effectiveIdx = status === 'REJECTED' ? 1 : currentIdx;

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, idx) => {
        const isRejected = step === 'APPROVED' && status === 'REJECTED';
        const isActive = idx <= effectiveIdx && status !== 'REJECTED';
        const isCurrent = idx === effectiveIdx;

        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                isRejected ? 'border-rose-500 bg-rose-500/20 text-rose-400' :
                isActive ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' :
                'border-slate-700 bg-slate-800 text-slate-600'
              }`}>
                {isRejected ? '✕' : isActive ? '✓' : idx + 1}
              </div>
              <span className={`text-[9px] font-mono ${
                isRejected ? 'text-rose-400' : isActive ? 'text-emerald-400' : 'text-slate-600'
              }`}>
                {isRejected ? 'REJECTED' : step}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-px w-8 mb-4 ${isActive && !isRejected ? 'bg-emerald-500' : 'bg-slate-700'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const RefundsPage = () => {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/refunds');
      setRefunds(res.data.refunds || []);
    } catch (err) {
      console.error('Error fetching refunds:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRefunds(); }, [fetchRefunds]);

  const filtered = filter ? refunds.filter((r) => r.status === filter) : refunds;
  const counts = refunds.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-950/40 via-slate-900 to-slate-900 border border-teal-500/30 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <RotateCcw className="w-7 h-7 text-teal-400" /> My Refund Requests
          </h1>
          <p className="text-slate-300 text-sm mt-1 font-medium">Track the status of all refund requests you've submitted.</p>
        </div>
        <button onClick={fetchRefunds} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-5 gap-3 font-mono text-xs">
        {Object.entries(STATUS_STYLES).map(([st, meta]) => (
          <button
            key={st}
            onClick={() => setFilter(filter === st ? '' : st)}
            className={`rounded-xl border p-3 text-center transition-all ${filter === st ? meta.bg : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}
          >
            <div className="flex justify-center mb-1">{meta.icon}</div>
            <div className={`text-xl font-bold ${filter === st ? '' : 'text-white'}`}>{counts[st] || 0}</div>
            <div className={`text-xs font-semibold ${filter === st ? '' : 'text-slate-300'}`}>{meta.label}</div>
          </button>
        ))}
      </div>

      {/* Refunds List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-16 text-slate-300 font-mono text-xs font-medium">Loading refund requests…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <RotateCcw className="w-8 h-8 text-slate-500 mx-auto" />
            <div className="text-slate-200 text-base font-bold">No {filter || ''} refund requests</div>
            <p className="text-slate-300 text-xs font-medium">
              You can request a refund from any completed payment on the{' '}
              <Link to="/payments" className="text-teal-400 font-bold hover:underline">Payment History</Link> page.
            </p>
          </div>
        ) : (
          filtered.map((refund) => {
            const style = STATUS_STYLES[refund.status] || STATUS_STYLES.PENDING;
            const payment = refund.paymentId;

            return (
              <div key={refund._id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-colors shadow-lg">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">Refund ID</div>
                    <div className="text-sm font-mono font-bold text-white">{refund._id}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold ${style.bg}`}>
                      {style.icon} {refund.status}
                    </span>
                  </div>
                </div>

                {/* Timeline */}
                <div className="flex justify-center py-1">
                  <StatusTimeline status={refund.status} />
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-300 font-semibold mb-0.5">Refund Amount</div>
                    <div className="text-emerald-400 font-extrabold text-base">${refund.amount?.toFixed(2)}</div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-300 font-semibold mb-0.5">Original Payment</div>
                    <div className="text-slate-100 font-bold text-xs truncate" title={payment?._id}>${payment?.amount?.toFixed(2)}</div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-300 font-semibold mb-0.5">Requested</div>
                    <div className="text-slate-200 font-medium text-xs">{new Date(refund.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-300 font-semibold mb-0.5">Reviewed</div>
                    <div className="text-slate-200 font-medium text-xs">{refund.reviewedAt ? new Date(refund.reviewedAt).toLocaleDateString() : '—'}</div>
                  </div>
                </div>

                {/* Reason */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs">
                  <div className="text-slate-300 font-bold uppercase tracking-wider text-xs mb-1">Reason</div>
                  <div className="text-slate-100 font-medium">{refund.reason}</div>
                </div>

                {/* Admin note if present */}
                {refund.adminNote && (
                  <div className={`rounded-xl border p-3 text-xs font-medium ${style.bg}`}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1 opacity-90">Admin Note</div>
                    <div>{refund.adminNote}</div>
                  </div>
                )}

                {/* Completed refund payment link */}
                {refund.status === 'COMPLETED' && refund.refundPaymentId && (
                  <div className="flex items-center gap-2 text-xs font-mono text-teal-300 bg-teal-500/10 border border-teal-500/30 rounded-xl p-3 font-semibold">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-teal-400" />
                    <span>Refund credited to your wallet.</span>
                    <Link to={`/payments/${refund.refundPaymentId}`} className="ml-auto flex items-center gap-1 font-bold hover:underline text-teal-200">
                      View refund payment <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}

                {/* Link to original payment */}
                {payment && (
                  <Link
                    to={`/payments/${payment._id}`}
                    className="text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1 transition-colors font-semibold"
                  >
                    View original payment <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RefundsPage;
