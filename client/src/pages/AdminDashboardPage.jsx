import React, { useEffect, useState } from 'react';
import api from '../services/api';
import usePaymentEvents from '../hooks/usePaymentEvents';
import {
  ShieldAlert, Users, Activity, Cpu, RefreshCw, AlertTriangle, Sliders,
  DollarSign, Clock, Zap, Play, Layers, CheckCircle2, XCircle, Database,
  GitBranch, Wifi, WifiOff, Server, Timer, Flame, RotateCcw, Shield, RotateCw,
} from 'lucide-react';

const StatusDot = ({ online }) => (
  <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
);

const StatCard = ({ label, value, color = 'text-white', icon }) => (
  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-md">
    {icon && <div className="mb-1">{icon}</div>}
    <div className="text-slate-300 text-xs font-semibold">{label}</div>
    <div className={`text-2xl font-extrabold ${color} mt-1`}>{value ?? '0'}</div>
  </div>
);

const SimToggle = ({ label, description, icon, active, onTrigger, loading, colorClass = 'rose' }) => (
  <div className={`bg-slate-950 p-4 rounded-xl border ${active ? `border-${colorClass}-500/60` : 'border-slate-800'} space-y-2.5 shadow-md`}>
    <div className={`flex items-center gap-2 font-bold text-xs ${active ? `text-${colorClass}-300` : 'text-slate-200'}`}>
      {icon}
      <span>{label}</span>
      {active && <span className={`ml-auto text-xs bg-${colorClass}-500/20 text-${colorClass}-300 px-2 py-0.5 rounded font-bold uppercase`}>ARMED</span>}
    </div>
    <p className="text-slate-300 text-xs font-sans font-medium leading-relaxed">{description}</p>
    <button
      onClick={onTrigger}
      disabled={loading}
      className={`w-full py-2 rounded-lg border text-xs font-bold uppercase transition-all ${
        active
          ? `bg-${colorClass}-500/20 border-${colorClass}-500 text-${colorClass}-300`
          : 'bg-slate-900 border-slate-700 text-slate-200 hover:text-white hover:border-slate-500'
      }`}
    >
      {loading ? 'Arming...' : active ? 'Armed — Will Fire Next Job' : 'Arm Simulation'}
    </button>
  </div>
);

const CB_STATE_COLORS = { CLOSED: 'emerald', OPEN: 'red', HALF_OPEN: 'amber' };

const CircuitBreakerCard = ({ breaker, onReset, resetting }) => {
  const color = CB_STATE_COLORS[breaker.state] || 'slate';
  const secondsLeft = breaker.nextAttemptTime
    ? Math.max(0, Math.ceil((new Date(breaker.nextAttemptTime) - Date.now()) / 1000))
    : null;

  return (
    <div className={`bg-slate-950 p-4 rounded-xl border border-${color}-500/40 space-y-3 shadow-md`}>
      <div className="flex items-center justify-between">
        <div className={`text-sm font-bold text-${color}-300`}>{breaker.name}</div>
        <span className={`px-2.5 py-1 rounded-lg font-bold text-xs bg-${color}-500/20 text-${color}-300 uppercase border border-${color}-500/40`}>
          {breaker.state}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="text-slate-300 font-medium">Failures: <strong className="text-white font-bold">{breaker.failureCount}/{breaker.failureThreshold}</strong></div>
        <div className="text-slate-300 font-medium">Successes: <strong className="text-white font-bold">{breaker.successCount}/{breaker.successThreshold}</strong></div>
        {secondsLeft !== null && (
          <div className="text-slate-300 font-medium col-span-2">Reset in: <strong className="text-amber-300 font-bold">{secondsLeft}s</strong></div>
        )}
        {breaker.lastError && (
          <div className="col-span-2 text-slate-300 font-medium">Last error: <span className="text-rose-400 font-semibold break-words">{breaker.lastError.substring(0, 60)}</span></div>
        )}
      </div>
      {breaker.state !== 'CLOSED' && (
        <button
          onClick={() => onReset(breaker.name)}
          disabled={resetting}
          className="w-full py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg transition-colors"
        >
          {resetting ? 'Resetting...' : 'Reset to CLOSED'}
        </button>
      )}
    </div>
  );
};

const AdminDashboardPage = () => {
  const [stats, setStats] = useState(null);
  const [queueHealth, setQueueHealth] = useState(null);
  const [workersInfo, setWorkersInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [dlqJobs, setDlqJobs] = useState([]);
  const [dbHealth, setDbHealth] = useState(null);
  const [circuitBreakers, setCircuitBreakers] = useState([]);
  const [simConfig, setSimConfig] = useState({});
  const [loading, setLoading] = useState(true);

  const [demoDelayMs, setDemoDelayMs] = useState(5000);
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  const [selectedUserId, setSelectedUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('100');
  const [adjustReason, setAdjustReason] = useState('Admin demo funding');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustMsg, setAdjustMsg] = useState('');

  const [replayingId, setReplayingId] = useState(null);
  const [replayMsg, setReplayMsg] = useState('');
  const [armingType, setArmingType] = useState(null);
  const [clearingSimulations, setClearingSimulations] = useState(false);
  const [resettingCB, setResettingCB] = useState(null);

  // Refund management
  const [refunds, setRefunds] = useState([]);
  const [refundFilter, setRefundFilter] = useState('PENDING');
  const [processingRefund, setProcessingRefund] = useState(null);
  const [refundAdminNote, setRefundAdminNote] = useState('');
  const [refundActionMsg, setRefundActionMsg] = useState('');

  const fetchAdminData = async () => {
    try {
      const [statsRes, healthRes, workersRes, configRes, usersRes, dlqRes, dbRes, cbRes, refundsRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/queue-health'),
        api.get('/admin/workers'),
        api.get('/admin/config'),
        api.get('/admin/users'),
        api.get('/admin/dlq'),
        api.get('/admin/db-health'),
        api.get('/admin/circuit-breaker'),
        api.get('/admin/refunds'),
      ]);

      setStats(statsRes.data);
      setQueueHealth(healthRes.data);
      setWorkersInfo(workersRes.data);
      setUsers(usersRes.data);
      setDlqJobs(dlqRes.data?.jobs || []);
      setDbHealth(dbRes.data);
      setCircuitBreakers(cbRes.data?.circuitBreakers || []);
      setRefunds(refundsRes.data?.refunds || []);
      setDemoDelayMs(configRes.data.demoDelayMs ?? 5000);
      setSimConfig({
        simulateOneFailure: configRes.data.simulateOneFailure,
        simulateNetworkError: configRes.data.simulateNetworkError,
        simulateDbError: configRes.data.simulateDbError,
        simulateTimeout: configRes.data.simulateTimeout,
        simulateServerError: configRes.data.simulateServerError,
        simulateWorkerCrash: configRes.data.simulateWorkerCrash,
        simulateOutage: configRes.data.simulateOutage,
      });

      if (usersRes.data.length > 0 && !selectedUserId) {
        setSelectedUserId(usersRes.data[0].id);
      }
    } catch (err) {
      console.error('Error loading admin telemetry data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 5000);
    return () => clearInterval(interval);
  }, []);

  usePaymentEvents(() => fetchAdminData());

  const handleUpdateDelay = async (ms) => {
    setUpdatingConfig(true);
    setConfigMsg('');
    try {
      await api.post('/admin/config', { demoDelayMs: ms });
      setDemoDelayMs(ms);
      setConfigMsg('✅ Delay updated');
      setTimeout(() => setConfigMsg(''), 3000);
    } catch (err) {
      setConfigMsg('❌ Failed to update delay');
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleArmSimulation = async (type) => {
    setArmingType(type);
    try {
      await api.post('/admin/simulations/trigger', { type });
      await fetchAdminData();
    } catch (err) {
      console.error('Failed to arm simulation:', err);
    } finally {
      setArmingType(null);
    }
  };

  const handleClearSimulations = async () => {
    setClearingSimulations(true);
    try {
      await api.post('/admin/simulations/clear');
      await fetchAdminData();
    } catch (err) {
      console.error('Failed to clear simulations:', err);
    } finally {
      setClearingSimulations(false);
    }
  };

  const handleResetCB = async (name) => {
    setResettingCB(name);
    try {
      await api.post('/admin/circuit-breaker/reset', { name });
      await fetchAdminData();
    } catch (err) {
      console.error('Failed to reset CB:', err);
    } finally {
      setResettingCB(null);
    }
  };

  const handleApproveRefund = async (refundId) => {
    setProcessingRefund(refundId);
    setRefundActionMsg('');
    try {
      const res = await api.post(`/admin/refunds/${refundId}/approve`, {
        adminNote: refundAdminNote || undefined,
      });
      setRefundActionMsg(`✅ Refund approved — $${res.data.newSenderBalance?.toFixed(2)} credited back to sender`);
      setRefundAdminNote('');
      fetchAdminData();
    } catch (err) {
      setRefundActionMsg(`❌ ${err.response?.data?.error || 'Failed to approve'}`);
    } finally {
      setProcessingRefund(null);
    }
  };

  const handleRejectRefund = async (refundId) => {
    setProcessingRefund(refundId);
    setRefundActionMsg('');
    try {
      await api.post(`/admin/refunds/${refundId}/reject`, {
        adminNote: refundAdminNote || undefined,
      });
      setRefundActionMsg('✅ Refund request rejected');
      setRefundAdminNote('');
      fetchAdminData();
    } catch (err) {
      setRefundActionMsg(`❌ ${err.response?.data?.error || 'Failed to reject'}`);
    } finally {
      setProcessingRefund(null);
    }
  };

  const handleReplayPayment = async (paymentId) => {
    if (!paymentId) return;
    setReplayingId(paymentId);
    setReplayMsg('');
    try {
      const res = await api.post(`/admin/payments/${paymentId}/replay`);
      setReplayMsg(`✅ Replay queued for #${paymentId.substring(0, 8)}... (Job: ${res.data.jobId})`);
      setTimeout(() => setReplayMsg(''), 4000);
      fetchAdminData();
    } catch (err) {
      setReplayMsg(`❌ Replay failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setReplayingId(null);
    }
  };

  const handleAdjustWallet = async (e) => {
    e.preventDefault();
    setAdjusting(true);
    setAdjustMsg('');
    try {
      const res = await api.post('/admin/wallet-adjustment', {
        userId: selectedUserId,
        amount: Number(adjustAmount),
        reason: adjustReason,
      });
      setAdjustMsg(`✅ Wallet updated! New balance: $${res.data.newBalance.toFixed(2)}`);
      fetchAdminData();
    } catch (err) {
      setAdjustMsg(`❌ Failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setAdjusting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16 text-slate-500 font-mono text-xs">
        Loading Admin Telemetry & BullMQ Worker Monitoring...
      </div>
    );
  }

  const registeredCount = workersInfo?.registeredWorkerCount ?? 0;
  const onlineCount = workersInfo?.onlineWorkerCount ?? 0;
  const staleCount = workersInfo?.staleWorkerCount ?? 0;
  const activeWorkerList = workersInfo?.workers || [];
  const primaryWorker = activeWorkerList[0] || null;
  const anySimActive = Object.values(simConfig).some(Boolean);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/20 rounded-2xl p-6 lg:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/20 px-2.5 py-0.5 rounded-full">
              System Admin Control Center
            </span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <ShieldAlert className="w-7 h-7 text-purple-400" />
            Admin Observability Dashboard
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-mono">
            Redis + BullMQ queue telemetry, DB health, circuit breakers, failure injection, DLQ replay, and multi-worker monitoring.
          </p>
        </div>
        <button
          onClick={fetchAdminData}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors self-start md:self-auto font-mono"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh Metrics
        </button>
      </div>

      {/* === DATABASE HEALTH MONITORING === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Database className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-base font-bold text-white">Database Health Monitor</h2>
            <p className="text-xs text-slate-400">MongoDB connectivity, response time, replica set topology, and replication status.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusDot online={dbHealth?.connected} />
            <span className={`text-xs font-bold ${dbHealth?.connected ? 'text-emerald-400' : 'text-red-400'}`}>
              {dbHealth?.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500">Response Time</div>
            <div className={`text-xl font-bold mt-1 ${dbHealth?.responseTimeMs < 50 ? 'text-emerald-400' : dbHealth?.responseTimeMs < 200 ? 'text-amber-400' : 'text-red-400'}`}>
              {dbHealth?.responseTimeMs != null ? `${dbHealth.responseTimeMs}ms` : 'N/A'}
            </div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500">Topology</div>
            <div className="text-xl font-bold text-purple-300 mt-1 capitalize">{dbHealth?.topology ?? 'unknown'}</div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500">Role</div>
            <div className={`text-xl font-bold mt-1 ${dbHealth?.isPrimary ? 'text-emerald-400' : 'text-amber-400'}`}>
              {dbHealth?.isPrimary ? 'PRIMARY' : dbHealth?.connected ? 'SECONDARY' : 'N/A'}
            </div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-500">Replication</div>
            <div className={`text-xl font-bold mt-1 capitalize ${
              dbHealth?.replicationStatus === 'healthy' ? 'text-emerald-400' :
              dbHealth?.replicationStatus === 'lagging' ? 'text-amber-400' :
              dbHealth?.replicationStatus === 'not_applicable' ? 'text-slate-400' : 'text-slate-500'
            }`}>{dbHealth?.replicationStatus ?? '—'}</div>
          </div>
        </div>
        {dbHealth?.replicaSet && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
            <div className="text-slate-400">Replica Set: <strong className="text-purple-300">{dbHealth.replicaSet}</strong></div>
            <div className="text-slate-400">Primary: <strong className="text-emerald-300">{dbHealth.primary || 'N/A'}</strong></div>
            <div className="text-slate-400">This node: <strong className="text-slate-200">{dbHealth.me || 'N/A'}</strong></div>
            {dbHealth.secondaryHosts?.length > 0 && (
              <div className="text-slate-400">
                Secondaries:{' '}
                {dbHealth.secondaryHosts.map((s, i) => (
                  <span key={i} className="ml-2 text-slate-200">
                    {s.name}{s.lag !== null ? ` (lag: ${s.lag}s)` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {!dbHealth?.replicaSet && (
          <div className="text-xs text-slate-500 font-mono italic">
            ℹ️ Connected to a {dbHealth?.topology === 'standalone' ? 'standalone' : 'sharded'} deployment — replica set topology details unavailable (Atlas serverless or single-node).
          </div>
        )}
      </div>

      {/* === CIRCUIT BREAKER STATUS === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Shield className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-base font-bold text-white">Circuit Breaker Monitor</h2>
            <p className="text-xs text-slate-400">CLOSED = normal, OPEN = blocking requests, HALF_OPEN = recovery probe</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {circuitBreakers.length === 0 ? (
            <div className="text-slate-500 text-xs font-mono col-span-2">Loading circuit breaker state...</div>
          ) : (
            circuitBreakers.map((cb) => (
              <CircuitBreakerCard
                key={cb.name}
                breaker={cb}
                onReset={handleResetCB}
                resetting={resettingCB === cb.name}
              />
            ))
          )}
        </div>
      </div>

      {/* === FAILURE SIMULATION CONTROL MATRIX === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Failure Simulation Control Matrix</h2>
              <p className="text-xs text-slate-400">Arm failure scenarios. Each simulation fires once on the next queued payment job, then auto-disarms.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {anySimActive && (
              <span className="text-xs font-mono font-bold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-1 rounded-full animate-pulse">
                ⚠ SIMULATION ARMED
              </span>
            )}
            <button
              onClick={handleClearSimulations}
              disabled={clearingSimulations || !anySimActive}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold disabled:opacity-50 transition-colors"
            >
              {clearingSimulations ? 'Clearing...' : 'Clear All'}
            </button>
          </div>
        </div>

        {/* Delay Control */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-slate-300 font-bold text-xs">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Processing Delay (Demo Trace Visibility)</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0, 3000, 5000, 10000].map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => handleUpdateDelay(ms)}
                disabled={updatingConfig}
                className={`py-2 px-3 rounded-lg border font-bold text-xs transition-colors ${
                  demoDelayMs === ms
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {ms === 0 ? '0ms' : `${ms / 1000}s`}
              </button>
            ))}
          </div>
          {configMsg && <span className="text-xs font-mono text-emerald-400">{configMsg}</span>}
        </div>

        {/* Simulation Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
          <SimToggle
            label="1. Network Error"
            description="Simulates TCP/network connection failure to payment gateway. Retries with exponential backoff."
            icon={<WifiOff className="w-4 h-4 text-rose-400" />}
            active={simConfig.simulateNetworkError}
            onTrigger={() => handleArmSimulation('network_error')}
            loading={armingType === 'network_error'}
          />
          <SimToggle
            label="2. API / Server Error"
            description="Simulates HTTP 500 internal server error from the payment service API. Retryable."
            icon={<Server className="w-4 h-4 text-orange-400" />}
            active={simConfig.simulateServerError}
            onTrigger={() => handleArmSimulation('server_error')}
            loading={armingType === 'server_error'}
            colorClass="orange"
          />
          <SimToggle
            label="3. Database Failure"
            description="Simulates MongoDB becoming unavailable. Triggers DatabaseTransientError with retry backoff."
            icon={<Database className="w-4 h-4 text-amber-400" />}
            active={simConfig.simulateDbError}
            onTrigger={() => handleArmSimulation('database_error')}
            loading={armingType === 'database_error'}
            colorClass="amber"
          />
          <SimToggle
            label="4. Timeout"
            description="Simulates a 30s timeout. Performs idempotency check before retry to avoid duplicate payment."
            icon={<Timer className="w-4 h-4 text-yellow-400" />}
            active={simConfig.simulateTimeout}
            onTrigger={() => handleArmSimulation('timeout')}
            loading={armingType === 'timeout'}
            colorClass="yellow"
          />
          <SimToggle
            label="5. Worker Crash"
            description="Simulates worker process crash before transaction commit. Another worker recovers the abandoned job."
            icon={<Cpu className="w-4 h-4 text-purple-400" />}
            active={simConfig.simulateWorkerCrash}
            onTrigger={() => handleArmSimulation('worker_crash')}
            loading={armingType === 'worker_crash'}
            colorClass="purple"
          />
          <SimToggle
            label="6. Worker Fault"
            description="Generic controlled worker failure before commit on Attempt #1. BullMQ retries on Attempt #2."
            icon={<Zap className="w-4 h-4 text-rose-400" />}
            active={simConfig.simulateOneFailure}
            onTrigger={() => handleArmSimulation('worker_fault')}
            loading={armingType === 'worker_fault'}
          />
          <SimToggle
            label="7. Infrastructure Outage"
            description="Simulates a complete system outage — all services blocked. Highest priority simulation."
            icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
            active={simConfig.simulateOutage}
            onTrigger={() => handleArmSimulation('outage')}
            loading={armingType === 'outage'}
            colorClass="red"
          />
        </div>

        <div className="text-[11px] text-slate-500 font-mono bg-slate-950 p-3 rounded-lg border border-slate-800">
          <strong className="text-slate-300">Simulated vs Real:</strong> All simulations are labelled <code>[SIM]</code> in audit logs, error messages, and trace timelines. Real failures show actual error details without the [SIM] prefix.
          Permanent failures (insufficient_balance, payment_not_found) are never retried. Transient failures (network, db, timeout) use bounded exponential backoff.
        </div>
      </div>

      {/* === BULLMQ QUEUE TELEMETRY === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            BullMQ + Redis Queue Telemetry (payment-processing)
          </h3>
          <span className="text-emerald-400 text-[11px] font-bold">REDIS + BULLMQ LIVE</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Waiting (Queued)" value={queueHealth?.queuedCount} color="text-amber-400" />
          <StatCard label="Active (Processing)" value={queueHealth?.processingCount} color="text-cyan-400" />
          <StatCard label="Delayed (Retrying)" value={queueHealth?.retryingCount} color="text-purple-400" />
          <StatCard label="Completed Jobs" value={queueHealth?.successCount} color="text-emerald-400" />
          <StatCard label="Failed / DLQ" value={queueHealth?.failedCount} color="text-rose-400" />
        </div>
        <div className="grid grid-cols-3 gap-4 pt-2">
          <StatCard label="Registered Workers" value={registeredCount} />
          <StatCard label="Online Workers" value={onlineCount} color="text-emerald-400" />
          <StatCard label="Stale/Offline Workers" value={staleCount} color="text-slate-400" />
        </div>
      </div>

      {/* === WORKER HEARTBEAT === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-purple-400" />
          Active BullMQ Worker Processes
        </h3>
        {activeWorkerList.length === 0 ? (
          <div className="text-slate-500 text-xs font-mono py-4 text-center">No worker registered in MongoDB yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase">
                  <th className="pb-3 px-3">Worker ID</th>
                  <th className="pb-3 px-3">PID</th>
                  <th className="pb-3 px-3">Status</th>
                  <th className="pb-3 px-3">Current Job</th>
                  <th className="pb-3 px-3">Last Heartbeat</th>
                  <th className="pb-3 px-3">Uptime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {activeWorkerList.map((w) => (
                  <tr key={w.workerId} className="hover:bg-slate-800/30">
                    <td className="py-3 px-3 text-purple-300 font-bold">{w.workerId}</td>
                    <td className="py-3 px-3 text-slate-300">{w.processId}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded font-bold ${w.isStale || w.status === 'OFFLINE' ? 'bg-rose-500/20 text-rose-300' : w.status === 'PROCESSING' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">{w.currentJobId || 'None'}</td>
                    <td className="py-3 px-3 text-slate-300">
                      {w.lastHeartbeat ? new Date(w.lastHeartbeat).toLocaleTimeString() : 'Unavailable'}
                    </td>
                    <td className="py-3 px-3 text-emerald-400 font-bold">
                      {w.uptimeMs ? `${Math.floor(w.uptimeMs / 1000)}s` : 'Unavailable'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* === DLQ & PAYMENT REPLAY === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              Dead-Letter Queue (DLQ) &amp; Payment Replay
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Exhausted or non-recoverable payment jobs. Admins can safely replay FAILED payments. Idempotency is enforced.
            </p>
          </div>
          {replayMsg && (
            <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-xl">
              {replayMsg}
            </span>
          )}
        </div>

        {dlqJobs.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-6 text-center text-slate-500 text-xs font-mono">
            <CheckCircle2 className="w-6 h-6 text-emerald-500/50 mx-auto mb-2" />
            Dead-Letter Queue is clean. No permanently failed jobs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase">
                  <th className="pb-3 px-3">Payment ID</th>
                  <th className="pb-3 px-3">Sender → Recipient</th>
                  <th className="pb-3 px-3">Attempts</th>
                  <th className="pb-3 px-3">Error</th>
                  <th className="pb-3 px-3">Failed At</th>
                  <th className="pb-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {dlqJobs.map((job) => (
                  <tr key={job.jobId} className="hover:bg-slate-800/30">
                    <td className="py-3 px-3 text-slate-300 font-bold" title={job.paymentId}>{(job.paymentId || 'N/A').substring(0, 12)}…</td>
                    <td className="py-3 px-3 text-slate-400">
                      {job.payment?.senderId?.name || 'Sender'} → {job.payment?.recipientId?.name || 'Recipient'} (${job.payment?.amount || 0})
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300">
                        {job.attemptsMade} / {job.maxAttempts}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-rose-400 max-w-[200px] truncate" title={job.failedReason}>
                      {job.failedReason || 'Unknown error'}
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {job.failedTimestamp ? new Date(job.failedTimestamp).toLocaleTimeString() : 'N/A'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => handleReplayPayment(job.paymentId)}
                        disabled={replayingId === job.paymentId}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-xs uppercase flex items-center gap-1.5 ml-auto transition-colors disabled:opacity-50"
                      >
                        <Play className="w-3 h-3" />
                        {replayingId === job.paymentId ? 'Replaying...' : 'Replay'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* === REFUND MANAGEMENT === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-teal-400" /> Refund Management
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Approve or reject user refund requests. Approvals execute atomic wallet reversal.</p>
          </div>
          <div className="flex items-center gap-2">
            {refundActionMsg && (
              <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-xl">
                {refundActionMsg}
              </span>
            )}
            {/* Filter */}
            <div className="flex items-center gap-1">
              {['PENDING', 'COMPLETED', 'REJECTED', ''].map((f) => (
                <button
                  key={f}
                  onClick={() => setRefundFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-colors ${
                    refundFilter === f ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f || 'ALL'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Admin note (shared across approve/reject) */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={refundAdminNote}
            onChange={(e) => setRefundAdminNote(e.target.value)}
            placeholder="Optional admin note for approve/reject…"
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-teal-500"
          />
        </div>

        {/* Refunds list */}
        {(refundFilter ? refunds.filter((r) => r.status === refundFilter) : refunds).length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs font-mono">
            No {refundFilter || ''} refund requests.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase">
                  <th className="pb-3 px-3">Refund ID</th>
                  <th className="pb-3 px-3">User</th>
                  <th className="pb-3 px-3">Payment</th>
                  <th className="pb-3 px-3">Amount</th>
                  <th className="pb-3 px-3">Reason</th>
                  <th className="pb-3 px-3">Status</th>
                  <th className="pb-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(refundFilter ? refunds.filter((r) => r.status === refundFilter) : refunds).map((refund) => (
                  <tr key={refund._id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-3 text-slate-400 text-[10px]">{refund._id?.substring(0, 10)}…</td>
                    <td className="py-3 px-3">
                      <div className="text-slate-200 font-bold">{refund.requestedBy?.name}</div>
                      <div className="text-slate-500 text-[10px]">{refund.requestedBy?.email}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[10px]">
                      {typeof refund.paymentId === 'object' ? refund.paymentId?._id?.substring(0, 10) : refund.paymentId?.substring(0, 10)}…
                    </td>
                    <td className="py-3 px-3 text-emerald-400 font-bold">${refund.amount?.toFixed(2)}</td>
                    <td className="py-3 px-3 text-slate-400 max-w-[150px] truncate" title={refund.reason}>{refund.reason}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                        refund.status === 'PENDING' ? 'bg-amber-500/20 text-amber-300' :
                        refund.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' :
                        refund.status === 'REJECTED' ? 'bg-rose-500/20 text-rose-300' :
                        'bg-slate-700 text-slate-300'
                      }`}>{refund.status}</span>
                    </td>
                    <td className="py-3 px-3">
                      {refund.status === 'PENDING' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApproveRefund(refund._id)}
                            disabled={processingRefund === refund._id}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[11px] disabled:opacity-50 flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {processingRefund === refund._id ? '…' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleRejectRefund(refund._id)}
                            disabled={processingRefund === refund._id}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] disabled:opacity-50 flex items-center gap-1"
                          >
                            <XCircle className="w-3 h-3" />
                            {processingRefund === refund._id ? '…' : 'Reject'}
                          </button>
                        </div>
                      )}
                      {refund.status !== 'PENDING' && <span className="text-slate-600 text-[11px]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* === WALLET ADJUSTMENT TOOL === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Admin Wallet Balance Adjustment Tool
          </h3>
          <p className="text-xs text-slate-400">Inject or adjust funds into user wallets for demo purposes. Every adjustment is logged to the Audit Trail.</p>
        </div>

        {adjustMsg && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-200">
            {adjustMsg}
          </div>
        )}

        <form onSubmit={handleAdjustWallet} className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono text-xs">
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Target User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email}) - ${u.wallet?.balance || 0}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Amount ($)</label>
            <input
              type="number" step="0.01" required value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-bold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Reason Note</label>
            <input
              type="text" required value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit" disabled={adjusting}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors text-xs uppercase"
            >
              {adjusting ? 'Updating...' : 'Adjust Wallet'}
            </button>
          </div>
        </form>
      </div>

      {/* === ALL USERS === */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-slate-400" />
          All Registered Users &amp; Wallets
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase">
                <th className="pb-3 px-3">User ID</th>
                <th className="pb-3 px-3">Name</th>
                <th className="pb-3 px-3">Email</th>
                <th className="pb-3 px-3">Role</th>
                <th className="pb-3 px-3">Wallet Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-3 text-slate-400">{u.id}</td>
                  <td className="py-3 px-3 text-white font-bold">{u.name}</td>
                  <td className="py-3 px-3 text-slate-300">{u.email}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded font-bold ${u.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-800 text-slate-300'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-emerald-400 font-bold">${(u.wallet?.balance || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardPage;
