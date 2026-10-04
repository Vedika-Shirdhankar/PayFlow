require('dotenv').config();
const connectDB = require('./config/db');
const PaymentWorker = require('./workers/paymentWorker');

const runWorker = async () => {
  console.log('Starting PayFlow Payment Worker Process...');

  // Connect to MongoDB Atlas (Mandatory)
  await connectDB();

  // Stable worker ID: use process.env.WORKER_ID if provided, else worker-node-<PID>
  const workerId = process.env.WORKER_ID || `worker-node-${process.pid}`;
  const worker = new PaymentWorker(workerId);

  // NOTE: SIGINT and SIGTERM are handled inside PaymentWorker.start()
  // The worker handles graceful OFFLINE heartbeat update to MongoDB before exiting.
  await worker.start();
};

runWorker().catch((err) => {
  console.error('Fatal error running worker:', err);
  process.exit(1);
});
