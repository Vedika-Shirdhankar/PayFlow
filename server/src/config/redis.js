const Redis = require('ioredis');

const EVENTS_CHANNEL = 'payflow:events';

const getRedisConfig = () => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  };
};

const buildClient = () => {
  const config = getRedisConfig();
  if (typeof config === 'string') {
    return new Redis(config, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return new Redis(config);
};

let sharedRedisClient = null;

const getRedisClient = () => {
  if (!sharedRedisClient) {
    sharedRedisClient = buildClient();
    sharedRedisClient.on('connect', () => console.log('📡 Redis connection established'));
    sharedRedisClient.on('error', (err) => console.error('⚠️ Redis connection error:', err.message));
  }
  return sharedRedisClient;
};

const createRedisConnection = () => {
  const client = buildClient();
  client.on('error', (err) => console.error('⚠️ Redis connection error:', err.message));
  return client;
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

// maxRetriesPerRequest is null (required by BullMQ), so a ping would hang forever
// if Redis is down. A timeout keeps /api/health responsive.
const checkRedisHealth = async () => {
  try {
    const pong = await withTimeout(getRedisClient().ping(), 1500);
    return pong === 'PONG' ? 'connected' : 'degraded';
  } catch (err) {
    return 'disconnected';
  }
};

// ---- Cross-process realtime events (worker -> API -> Socket.IO) ----
let publisher = null;

const publishEvent = async (event, payload) => {
  try {
    if (!publisher) {
      publisher = createRedisConnection();
    }
    await publisher.publish(EVENTS_CHANNEL, JSON.stringify({ event, payload }));
  } catch (err) {
    console.error(`Failed to publish realtime event '${event}':`, err.message);
  }
};

const subscribeEvents = (handler) => {
  const subscriber = createRedisConnection();
  subscriber.subscribe(EVENTS_CHANNEL).catch((err) => {
    console.error('Failed to subscribe to realtime events:', err.message);
  });
  subscriber.on('message', (_channel, message) => {
    try {
      const { event, payload } = JSON.parse(message);
      handler(event, payload);
    } catch (err) {
      console.error('Invalid realtime event message:', err.message);
    }
  });
  return subscriber;
};

module.exports = {
  EVENTS_CHANNEL,
  getRedisConfig,
  getRedisClient,
  createRedisConnection,
  checkRedisHealth,
  publishEvent,
  subscribeEvents,
};
