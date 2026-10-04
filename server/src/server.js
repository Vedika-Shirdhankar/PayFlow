require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/db');
const { subscribeEvents } = require('./config/redis');
const { attachSocketAuth, routePaymentEvent } = require('./utils/realtime');

const PORT = process.env.PORT || 5000;

const assertEnv = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error(
      'JWT_SECRET is missing or too short (min 16 chars). Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
    process.exit(1);
  }
};

const startServer = async () => {
  assertEnv();
  await connectDB();

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
  });

  app.set('io', io);
  attachSocketAuth(io);

  // Worker (separate process) and API both publish to Redis; this process fans out to sockets.
  subscribeEvents((event, payload) => routePaymentEvent(io, event, payload));

  server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 PayFlow API Server listening on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`==================================================`);
  });
};

startServer();
