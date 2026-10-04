/**
 * seed.js — Create/update predefined demo accounts without touching existing data.
 *
 * Idempotent: safe to run multiple times.
 *   - If a user already exists, their password and role are updated.
 *   - If a wallet already exists, its balance is set to the target amount.
 *   - Nothing else in the database is touched.
 *
 * Usage:
 *   node scripts/seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const AuditLog = require('../src/models/AuditLog');

const connectForSeed = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined in .env');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  console.log(`Connected to MongoDB: ${mongoose.connection.host} (${mongoose.connection.name})`);
};

const ACCOUNTS = [
  {
    name: 'Alice',
    email: 'alice@payflow.com',
    password: 'User@123',
    role: 'USER',
    balance: 1000.00,
  },
  {
    name: 'Bob',
    email: 'bob@payflow.com',
    password: 'User@123',
    role: 'USER',
    balance: 500.00,
  },
  {
    name: 'System Admin',
    email: 'admin@payflow.com',
    password: 'Admin@123',
    role: 'ADMIN',
    balance: 0.00,
  },
];

const seed = async () => {
  await connectForSeed();
  console.log('\n🌱  PayFlow Demo Account Seeder');
  console.log('================================');
  console.log('ℹ️  Existing payments, audit logs, and transactions are untouched.\n');

  for (const account of ACCOUNTS) {
    const passwordHash = await bcrypt.hash(account.password, 12);

    // Upsert user: update if exists, create if not
    const user = await User.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          name: account.name,
          passwordHash,
          role: account.role,
          email: account.email,
        },
      },
      { upsert: true, new: true }
    );

    // Upsert wallet: set exact balance if wallet exists, create if not
    const walletBefore = await Wallet.findOne({ userId: user._id });
    const wallet = await Wallet.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          balance: account.balance,
          currency: 'USD',
        },
      },
      { upsert: true, new: true }
    );

    const action = walletBefore ? 'updated' : 'created';
    const balanceChange = walletBefore
      ? `$${walletBefore.balance.toFixed(2)} → $${wallet.balance.toFixed(2)}`
      : `$${wallet.balance.toFixed(2)}`;

    console.log(`  ✅  [${account.role}] ${account.name} <${account.email}>`);
    console.log(`       Password : ${account.password}`);
    console.log(`       Wallet   : ${action} — Balance: ${balanceChange}`);
    console.log(`       User ID  : ${user._id}`);
    console.log('');

    // Log the seeding action to audit trail
    await AuditLog.create({
      actorRole: 'SYSTEM',
      action: 'WALLET_ADJUSTED',
      entityType: 'User',
      entityId: user._id.toString(),
      metadata: {
        seeder: true,
        name: account.name,
        email: account.email,
        role: account.role,
        balance: account.balance,
        message: `Demo account ${action} by seed script`,
      },
    });
  }

  console.log('================================');
  console.log('✅  All demo accounts ready. You can now log in with the credentials above.');
  console.log('');

  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌  Seeder failed:', err.message);
  process.exit(1);
});
