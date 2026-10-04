const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { checkRedisHealth } = require('./config/redis');
const WorkerHeartbeat = require('./models/WorkerHeartbeat');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '50kb' }));

// Health check (registered before rate limiters so monitors are never throttled)
app.get('/api/health', async (req, res) => {
  try {
    const mongoState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const redisState = await checkRedisHealth();

    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);
    const activeWorkers =
      mongoState === 'connected'
        ? await WorkerHeartbeat.countDocuments({
            status: { $in: ['ONLINE', 'PROCESSING'] },
            lastHeartbeat: { $gte: cutoff },
          })
        : 0;

    const isHealthy = mongoState === 'connected' && redisState === 'connected';

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'OK' : 'DEGRADED',
      api: 'healthy',
      mongodb: mongoState,
      redis: redisState,
      worker: activeWorkers > 0 ? 'online' : 'offline',
      activeWorkersCount: activeWorkers,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'ERROR',
      api: 'healthy',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Rate limiting: generous global cap (the UI polls), strict cap on credential endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login/registration attempts. Try again later.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({
    error: err.status && err.status < 500 ? err.message : 'Internal Server Error',
  });
});

module.exports = app;
