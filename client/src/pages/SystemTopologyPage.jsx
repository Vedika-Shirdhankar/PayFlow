import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { Activity, RefreshCw, Wifi, WifiOff, Zap, AlertTriangle, Network } from 'lucide-react';

// ─── Node layout positions (percentage of SVG viewport) ───────────────────────
const NODE_POSITIONS = {
  'api-producer':       { cx: 50,  cy: 12 },
  'redis-bullmq':       { cx: 50,  cy: 38 },
  'node-worker':        { cx: 50,  cy: 64 },
  'mongo-primary':      { cx: 22,  cy: 86 },
  'mongo-secondaries':  { cx: 78,  cy: 86 },
  'realtime-monitor':   { cx: 84,  cy: 22 },
};

// Directed edges between nodes
const EDGES = [
  { from: 'api-producer',      to: 'redis-bullmq',      label: 'Enqueue Job' },
  { from: 'api-producer',      to: 'realtime-monitor',  label: 'SSE / WS' },
  { from: 'redis-bullmq',      to: 'node-worker',       label: 'Dequeue Job' },
  { from: 'node-worker',       to: 'mongo-primary',     label: 'Write TX' },
  { from: 'mongo-primary',     to: 'mongo-secondaries', label: 'Replication' },
  { from: 'node-worker',       to: 'realtime-monitor',  label: 'Emit Event' },
];

// ─── Status → visual color tokens ─────────────────────────────────────────────
const STATUS_COLORS = {
  HEALTHY:   { ring: '#10b981', fill: '#064e3b', glow: '#10b981', text: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  DEGRADED:  { ring: '#f59e0b', fill: '#451a03', glow: '#f59e0b', text: 'text-amber-400',   badge: 'bg-amber-500/20   text-amber-300   border-amber-500/40'   },
  UNHEALTHY: { ring: '#ef4444', fill: '#450a0a', glow: '#ef4444', text: 'text-red-400',     badge: 'bg-red-500/20    text-red-300     border-red-500/40'     },
  UNKNOWN:   { ring: '#64748b', fill: '#1e293b', glow: '#64748b', text: 'text-slate-400',   badge: 'bg-slate-700     text-slate-300   border-slate-600'     },
};

// ─── Node type → icon character ───────────────────────────────────────────────
const NODE_ICONS = {
  PRODUCER:           '⚡',
  QUEUE:              '📦',
  CONSUMER:           '⚙',
  DATABASE_PRIMARY:   '🗄',
  DATABASE_SECONDARY: '🗄',
  MONITOR:            '📡',
};

const NODE_LABELS_SHORT = {
  'api-producer':       ['Express API', 'Producer'],
  'redis-bullmq':       ['BullMQ +', 'Redis Queue'],
  'node-worker':        ['Node.js', 'Workers'],
  'mongo-primary':      ['MongoDB', 'Primary'],
  'mongo-secondaries':  ['MongoDB', 'Secondaries'],
  'realtime-monitor':   ['Socket.IO', 'Monitor'],
};

// ─── Animated dash offset for flowing edges ────────────────────────────────────
const FLOW_SPEED = { HEALTHY: 0.8, DEGRADED: 0.3, UNHEALTHY: 0 };

function useAnimFrame(cb) {
  const rafRef = useRef(null);
  const cbRef  = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    let last = performance.now();
    const loop = (now) => {
      cbRef.current(now - last, now);
      last = now;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function SystemTopologyPage() {
  const [topology, setTopology]   = useState(null);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState(null);
  const [selected, setSelected]   = useState(null);
  const [offsets,  setOffsets]    = useState({});    // edge id → dash offset
  const [pulses,   setPulses]     = useState({});    // nodeId  → pulse radius
  const [lastAt,   setLastAt]     = useState(null);

  // ── Fetch topology ────────────────────────────────────────────────────────
  const fetchTopology = useCallback(async () => {
    try {
      const res = await api.get('/admin/topology');
      setTopology(res.data);
      setLastAt(new Date());
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unable to reach server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopology();
    const iv = setInterval(fetchTopology, 4000);
    return () => clearInterval(iv);
  }, [fetchTopology]);

  // ── Animation frame for flowing edges & pulse rings ───────────────────────
  useAnimFrame((dt) => {
    if (!topology) return;

    setOffsets((prev) => {
      const next = { ...prev };
      EDGES.forEach((e) => {
        const edgeId     = `${e.from}__${e.to}`;
        const fromNode   = topology.nodes[nodeKeyById(e.from)];
        const speed      = fromNode
          ? FLOW_SPEED[fromNode.status] ?? FLOW_SPEED.UNKNOWN
          : 0;
        const delta      = (dt / 1000) * speed * 60;
        next[edgeId]     = ((prev[edgeId] || 0) + delta) % 100;
      });
      return next;
    });

    setPulses((prev) => {
      const next = { ...prev };
      Object.values(topology.nodes).forEach((n) => {
        if (n.status === 'UNHEALTHY') {
          next[n.id] = ((prev[n.id] || 0) + dt * 0.06) % 100;
        } else {
          next[n.id] = 0;
        }
      });
      return next;
    });
  });

  // ── Helper: map nodeId → topology.nodes key ───────────────────────────────
  function nodeKeyById(id) {
    if (!topology) return null;
    const k = Object.keys(topology.nodes).find((k) => topology.nodes[k].id === id);
    return k;
  }

  // ── Edge health: take the worst status from the two endpoints ─────────────
  function edgeStatus(edge) {
    if (!topology) return 'UNKNOWN';
    const fk = nodeKeyById(edge.from);
    const tk = nodeKeyById(edge.to);
    const fs = topology.nodes[fk]?.status ?? 'UNKNOWN';
    const ts = topology.nodes[tk]?.status ?? 'UNKNOWN';
    if (fs === 'UNHEALTHY' || ts === 'UNHEALTHY') return 'UNHEALTHY';
    if (fs === 'DEGRADED'  || ts === 'DEGRADED')  return 'DEGRADED';
    return 'HEALTHY';
  }

  // ── Count nodes by status ─────────────────────────────────────────────────
  const nodeCounts = topology
    ? Object.values(topology.nodes).reduce((acc, n) => {
        acc[n.status] = (acc[n.status] || 0) + 1;
        return acc;
      }, {})
    : {};

  const anyUnhealthy = (nodeCounts.UNHEALTHY || 0) > 0;
  const anyDegraded  = (nodeCounts.DEGRADED  || 0) > 0;

  const overallStatus = anyUnhealthy ? 'UNHEALTHY' : anyDegraded ? 'DEGRADED' : 'HEALTHY';
  const overallColors = STATUS_COLORS[overallStatus];

  const simActive = topology
    ? Object.values(topology.simulations || {}).some(Boolean)
    : false;

  // ── SVG layout math helpers ───────────────────────────────────────────────
  const VW = 800, VH = 520;
  function pos(id) {
    const p = NODE_POSITIONS[id];
    return p ? { x: (p.cx / 100) * VW, y: (p.cy / 100) * VH } : { x: 0, y: 0 };
  }

  function midpoint(from, to) {
    const f = pos(from), t = pos(to);
    return { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 };
  }

  // ─── Selected node data ───────────────────────────────────────────────────
  const selectedNode = selected && topology
    ? topology.nodes[nodeKeyById(selected)]
    : null;

  // ─── Loading/Error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-slate-500 font-mono text-sm">
        <div className="w-8 h-8 border-2 border-cyan-500/40 border-t-cyan-400 rounded-full animate-spin" />
        Connecting to system topology...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <WifiOff className="w-10 h-10 text-red-500" />
        <div className="text-red-400 font-mono text-sm">{error}</div>
        <button
          onClick={fetchTopology}
          className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 text-xs font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-slate-900 border border-cyan-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2.5 py-0.5 rounded-full">
              Live Infrastructure View
            </span>
            {simActive && (
              <span className="text-xs font-mono font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 rounded-full animate-pulse">
                ⚠ SIMULATION ACTIVE
              </span>
            )}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Network className="w-7 h-7 text-cyan-400" />
            Live System Topology Map
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-mono">
            Real-time visualization of API, workers, Redis/BullMQ, MongoDB replica set & Socket.IO monitor.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Overall health badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border font-mono text-xs font-bold ${overallColors.badge}`}>
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: overallColors.ring }}
            />
            System {overallStatus}
          </div>

          <button
            onClick={fetchTopology}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Status Summary Bar ── */}
      <div className="grid grid-cols-3 gap-4 font-mono text-xs">
        {[
          { label: 'Healthy Nodes',   count: nodeCounts.HEALTHY   || 0, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: 'Degraded Nodes',  count: nodeCounts.DEGRADED  || 0, color: 'text-amber-400',   bg: 'bg-amber-500/10   border-amber-500/20'   },
          { label: 'Unhealthy Nodes', count: nodeCounts.UNHEALTHY || 0, color: 'text-red-400',     bg: 'bg-red-500/10     border-red-500/20'     },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl border p-4 ${item.bg}`}>
            <div className="text-slate-400">{item.label}</div>
            <div className={`text-3xl font-bold mt-1 ${item.color}`}>{item.count}</div>
          </div>
        ))}
      </div>

      {/* ── Main Topology SVG + Detail Panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SVG Topology */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-2 overflow-hidden relative">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            className="w-full h-full"
            style={{ minHeight: 360 }}
          >
            <defs>
              {/* Radial glows for each status */}
              {Object.entries(STATUS_COLORS).map(([st, c]) => (
                <radialGradient key={st} id={`glow-${st}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stopColor={c.ring} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={c.ring} stopOpacity="0"    />
                </radialGradient>
              ))}

              {/* Arrowhead markers */}
              {Object.entries(STATUS_COLORS).map(([st, c]) => (
                <marker
                  key={st}
                  id={`arrow-${st}`}
                  markerWidth="8" markerHeight="8"
                  refX="6" refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill={c.ring} opacity="0.8" />
                </marker>
              ))}
            </defs>

            {/* ── Grid dots ── */}
            {Array.from({ length: 20 }).map((_, row) =>
              Array.from({ length: 30 }).map((_, col) => (
                <circle
                  key={`${row}-${col}`}
                  cx={col * 28 + 8}
                  cy={row * 28 + 8}
                  r="1"
                  fill="#1e293b"
                />
              ))
            )}

            {/* ── Edges ── */}
            {EDGES.map((edge) => {
              const f      = pos(edge.from);
              const t      = pos(edge.to);
              const st     = edgeStatus(edge);
              const col    = STATUS_COLORS[st];
              const edgeId = `${edge.from}__${edge.to}`;
              const offset = offsets[edgeId] || 0;
              const mid    = midpoint(edge.from, edge.to);
              const flowing = st !== 'UNHEALTHY';

              return (
                <g key={edgeId}>
                  {/* Shadow line */}
                  <line
                    x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                    stroke={col.ring}
                    strokeWidth="1"
                    strokeOpacity="0.15"
                  />
                  {/* Main line */}
                  <line
                    x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                    stroke={col.ring}
                    strokeWidth="2"
                    strokeOpacity={flowing ? 0.6 : 0.25}
                    strokeDasharray={flowing ? '10 8' : '4 6'}
                    strokeDashoffset={flowing ? -offset : 0}
                    markerEnd={`url(#arrow-${st})`}
                    style={{ transition: 'stroke 0.5s' }}
                  />
                  {/* Edge label */}
                  <text
                    x={mid.x} y={mid.y - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fill={col.ring}
                    opacity="0.7"
                    fontFamily="monospace"
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {/* ── Nodes ── */}
            {topology && Object.values(topology.nodes).map((node) => {
              const p     = pos(node.id);
              const col   = STATUS_COLORS[node.status] || STATUS_COLORS.UNKNOWN;
              const r     = 34;
              const pulse = pulses[node.id] || 0;
              const lines = NODE_LABELS_SHORT[node.id] || [node.label];
              const isSelected = selected === node.id;

              return (
                <g
                  key={node.id}
                  onClick={() => setSelected(selected === node.id ? null : node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Pulse ring for unhealthy nodes */}
                  {node.status === 'UNHEALTHY' && (
                    <circle
                      cx={p.x} cy={p.y}
                      r={r + 8 + pulse * 0.3}
                      fill="none"
                      stroke={col.ring}
                      strokeWidth="1.5"
                      opacity={Math.max(0, 0.6 - pulse * 0.008)}
                    />
                  )}

                  {/* Glow halo */}
                  <circle cx={p.x} cy={p.y} r={r + 20} fill={`url(#glow-${node.status})`} />

                  {/* Selected highlight ring */}
                  {isSelected && (
                    <circle
                      cx={p.x} cy={p.y} r={r + 8}
                      fill="none"
                      stroke="#60a5fa"
                      strokeWidth="2"
                      strokeDasharray="6 3"
                    />
                  )}

                  {/* Node body */}
                  <circle
                    cx={p.x} cy={p.y} r={r}
                    fill={col.fill}
                    stroke={col.ring}
                    strokeWidth={isSelected ? 3 : 2}
                    style={{ filter: `drop-shadow(0 0 8px ${col.glow}60)`, transition: 'all 0.4s' }}
                  />

                  {/* Icon */}
                  <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="18" dominantBaseline="middle">
                    {NODE_ICONS[node.type] || '●'}
                  </text>

                  {/* Status dot */}
                  <circle
                    cx={p.x + r - 8} cy={p.y - r + 8}
                    r="6"
                    fill={col.ring}
                    stroke="#0f172a"
                    strokeWidth="2"
                    style={{ filter: `drop-shadow(0 0 4px ${col.glow})` }}
                  />

                  {/* Label lines */}
                  {lines.map((line, i) => (
                    <text
                      key={i}
                      x={p.x}
                      y={p.y + r + 14 + i * 13}
                      textAnchor="middle"
                      fontSize={i === 0 ? '10' : '9'}
                      fontWeight={i === 0 ? 'bold' : 'normal'}
                      fill={i === 0 ? '#f1f5f9' : '#94a3b8'}
                      fontFamily="monospace"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>

          {/* Last update timestamp */}
          <div className="absolute bottom-3 right-4 text-[10px] font-mono text-slate-600">
            {lastAt ? `Last updated: ${lastAt.toLocaleTimeString()}` : ''}
          </div>
        </div>

        {/* ── Detail Panel ── */}
        <div className="space-y-4">
          {selectedNode ? (
            <NodeDetailPanel node={selectedNode} simulations={topology?.simulations} onClose={() => setSelected(null)} />
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-3 min-h-[200px]">
              <Activity className="w-8 h-8 text-slate-600" />
              <p className="text-slate-500 text-xs font-mono">Click a node on the map to inspect its live metrics.</p>
            </div>
          )}

          {/* Active Simulations */}
          {topology?.simulations && (
            <SimulationsPanel simulations={topology.simulations} />
          )}

          {/* Circuit Breakers */}
          {topology?.circuitBreaker && (
            <CircuitBreakerMiniPanel cb={topology.circuitBreaker} />
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-6 text-xs font-mono">
          <span className="text-slate-300 font-bold uppercase tracking-wider">Legend</span>
          {Object.entries(STATUS_COLORS).filter(([k]) => k !== 'UNKNOWN').map(([st, c]) => (
            <div key={st} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c.ring, boxShadow: `0 0 6px ${c.ring}` }} />
              <span className="text-slate-200 font-semibold">{st}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 ml-2">
            <svg width="32" height="8">
              <line x1="0" y1="4" x2="28" y2="4" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" />
            </svg>
            <span className="text-slate-300 font-medium">Flowing = data in transit</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="32" height="8">
              <line x1="0" y1="4" x2="28" y2="4" stroke="#ef4444" strokeWidth="2" strokeDasharray="3 5" strokeOpacity="0.4" />
            </svg>
            <span className="text-slate-300 font-medium">Dashed = link down</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Node Detail Panel ─────────────────────────────────────────────────────────
function NodeDetailPanel({ node, simulations, onClose }) {
  const col = STATUS_COLORS[node.status] || STATUS_COLORS.UNKNOWN;

  return (
    <div className={`bg-slate-900 border rounded-2xl p-5 space-y-4`} style={{ borderColor: col.ring + '60' }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">{node.type?.replace('_', ' ')}</div>
          <div className="text-lg font-extrabold text-white mt-0.5">{node.label}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg font-bold text-xs border ${col.badge}`}>
            {node.status}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">✕</button>
        </div>
      </div>

      <div className="space-y-2 font-mono text-xs">
        {Object.entries(node.details || {}).map(([key, val]) => {
          if (val === null || val === undefined) return null;
          const label = key.replace(/([A-Z])/g, ' $1').trim();
          const displayVal = typeof val === 'boolean' ? (val ? '✅ Yes' : '—') : String(val);
          const isAlert = key === 'faultSimulated' && val === true;
          return (
            <div key={key} className={`flex justify-between gap-2 py-1.5 border-b border-slate-800 ${isAlert ? 'text-rose-400' : ''}`}>
              <span className="text-slate-300 font-medium capitalize">{label}</span>
              <span className={`font-bold ${isAlert ? 'text-rose-400' : 'text-slate-100'}`}>{displayVal}</span>
            </div>
          );
        })}
      </div>

      {node.details?.faultSimulated && (
        <div className="flex items-center gap-2 text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Fault simulation is active — this node is simulating a failure.
        </div>
      )}
    </div>
  );
}

// ─── Simulations Mini Panel ────────────────────────────────────────────────────
function SimulationsPanel({ simulations }) {
  const active = Object.entries(simulations).filter(([, v]) => v);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
        <Zap className="w-4 h-4 text-rose-400" />
        Active Simulations
      </div>
      {active.length === 0 ? (
        <div className="text-slate-400 text-xs font-mono font-medium">No simulations armed.</div>
      ) : (
        active.map(([key]) => (
          <div key={key} className="flex items-center gap-2 text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-1.5 font-semibold">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse shrink-0" />
            {key.replace(/simulate/, '').replace(/([A-Z])/g, ' $1').trim()}
          </div>
        ))
      )}
    </div>
  );
}

// ─── Circuit Breaker Mini Panel ────────────────────────────────────────────────
function CircuitBreakerMiniPanel({ cb }) {
  const entries = Object.entries(cb);
  const stateColors = { CLOSED: 'text-emerald-400', OPEN: 'text-red-400', HALF_OPEN: 'text-amber-400' };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Circuit Breakers</div>
      {entries.map(([key, state]) => (
        <div key={key} className="flex justify-between items-center text-xs font-mono">
          <span className="text-slate-300 font-medium">{state?.name || key}</span>
          <span className={`font-bold px-2.5 py-0.5 rounded-md ${stateColors[state?.state] || 'text-slate-300'} bg-slate-800 border border-slate-700/60`}>
            {state?.state || 'UNKNOWN'}
          </span>
        </div>
      ))}
    </div>
  );
}
