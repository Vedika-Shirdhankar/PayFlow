import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';
import usePaymentEvents from '../hooks/usePaymentEvents';
import { Search, RefreshCw, GitCommit, ChevronLeft, ChevronRight, Tag, RotateCcw } from 'lucide-react';

const PRESET_TAGS = ['College', 'Travel', 'Food', 'Essentials', 'Bills', 'Gift', 'Business'];
const TAG_COLORS = {
  College: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Travel: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Food: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Essentials: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  Bills: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  Gift: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  Business: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};
const getTagColor = (tag) => TAG_COLORS[tag] || 'bg-slate-700/60 text-slate-300 border-slate-600';

const REFUND_STATUS_DOT = {
  PENDING:   'text-amber-400',
  APPROVED:  'text-blue-400',
  REJECTED:  'text-rose-400',
  COMPLETED: 'text-teal-400',
};

const PaymentHistoryPage = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 10;

  const fetchPayments = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get(`/payments?${params.toString()}`);
      let list = res.data.payments || [];
      // Client-side tag filter (server doesn't support it yet — tags array is in payment doc)
      if (tagFilter) {
        list = list.filter((p) => Array.isArray(p.tags) && p.tags.includes(tagFilter));
      }
      setPayments(list);
      setPages(res.data.pages || 1);
      setTotal(tagFilter ? list.length : (res.data.total || 0));
    } catch (err) {
      console.error('Error fetching payments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPayments(); }, [statusFilter, tagFilter, page]);
  usePaymentEvents(() => fetchPayments({ silent: true }));

  const handleSearch = (e) => {
    e.preventDefault();
    if (page !== 1) setPage(1);
    else fetchPayments();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Payment History</h1>
          <p className="text-slate-400 text-xs mt-1">View status and details of all enqueued payment jobs</p>
        </div>
        <button
          onClick={fetchPayments}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors self-start"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        {/* Search + Status */}
        <div className="flex flex-col md:flex-row gap-3">
          <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Payment ID…"
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </form>
          <div className="flex items-center gap-2 overflow-x-auto flex-wrap">
            {['', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED'].map((st) => (
              <button
                key={st}
                onClick={() => { setStatusFilter(st); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-colors shrink-0 ${
                  statusFilter === st ? 'bg-blue-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {st || 'ALL'}
              </button>
            ))}
          </div>
        </div>

        {/* Tag Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Tag className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[11px] text-slate-500 font-mono">Filter by tag:</span>
          <button
            onClick={() => { setTagFilter(''); setPage(1); }}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${tagFilter === '' ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            All
          </button>
          {PRESET_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => { setTagFilter(tagFilter === tag ? '' : tag); setPage(1); }}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${
                tagFilter === tag ? getTagColor(tag) : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        {loading ? (
          <div className="text-center py-12 text-slate-300 font-mono text-xs font-medium">Fetching payment history…</div>
        ) : payments.length === 0 ? (
          <div className="text-center py-12 text-slate-300 font-mono text-xs font-medium">No payments found matching filter criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700/80 text-slate-300 uppercase font-mono font-bold">
                  <th className="pb-3 px-3">Payment</th>
                  <th className="pb-3 px-3">Sender → Recipient</th>
                  <th className="pb-3 px-3">Amount</th>
                  <th className="pb-3 px-3">Tags & Note</th>
                  <th className="pb-3 px-3">Status</th>
                  <th className="pb-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {payments.map((p) => (
                  <tr key={p._id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-3">
                      <div className="text-slate-100 font-bold text-xs" title={p._id}>
                        {p._id.substring(0, 14)}…
                      </div>
                      <div className="text-slate-400 text-xs mt-0.5">{new Date(p.createdAt).toLocaleString()}</div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="text-slate-200 font-semibold">{p.senderId?.name || '—'}</div>
                      <div className="text-slate-400 text-xs">→ {p.recipientId?.name || '—'}</div>
                    </td>
                    <td className="py-3.5 px-3 font-extrabold text-emerald-400 text-sm">${p.amount.toFixed(2)}</td>
                    <td className="py-3.5 px-3 max-w-[200px]">
                      {/* Tags */}
                      {Array.isArray(p.tags) && p.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {p.tags.map((tag) => (
                            <span key={tag} className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${getTagColor(tag)}`}>{tag}</span>
                          ))}
                        </div>
                      )}
                      {/* Note */}
                      {p.note && (
                        <div className="text-slate-300 text-xs font-sans truncate font-medium" title={p.note}>
                          💬 {p.note}
                        </div>
                      )}
                      {/* Refund badge */}
                      {p.refundStatus && p.refundStatus !== 'NONE' && (
                        <div className={`text-xs font-bold mt-1 ${REFUND_STATUS_DOT[p.refundStatus] || 'text-slate-300'}`}>
                          ↩ Refund {p.refundStatus}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex flex-col gap-1.5">
                        <Link
                          to={`/payments/${p._id}/trace`}
                          className="px-3 py-1 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors font-bold flex items-center gap-1.5 w-max text-xs"
                        >
                          <GitCommit className="w-3.5 h-3.5 text-cyan-400" /> Trace
                        </Link>
                        <Link
                          to={`/payments/${p._id}`}
                          className="px-3 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition-colors font-bold flex items-center gap-1 w-max text-xs"
                        >
                          Details
                        </Link>
                        {p.status === 'SUCCESS' && p.refundStatus === 'NONE' && (
                          <Link
                            to={`/payments/${p._id}`}
                            className="px-3 py-1 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 font-bold flex items-center gap-1.5 w-max text-xs"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-teal-400" /> Refund
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-800 text-xs text-slate-400 font-mono">
            <span>Page {page} of {pages} · {total} payment{total === 1 ? '' : 's'}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-40 hover:bg-slate-700 flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, pages))}
                disabled={page >= pages}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-40 hover:bg-slate-700 flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentHistoryPage;
