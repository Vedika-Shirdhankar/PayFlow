const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    console.log('Connecting to MongoDB...');
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host} (${conn.connection.name})`);

    // Multi-document transactions only work on a replica set or sharded cluster.
    const hello = await conn.connection.db.admin().command({ hello: 1 });
    const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
    if (!supportsTransactions) {
      throw new Error(
        'MongoDB is running standalone, but PayFlow needs transactions. ' +
          'Use MongoDB Atlas or start a local replica set before starting the app.'
      );
    }
    console.log(
      `MongoDB transactions supported (${hello.setName ? `replica set "${hello.setName}"` : 'sharded cluster'}).`
    );

    return conn;
  } catch (error) {
    console.error(`MongoDB Connection Failure Error: ${error.message}`);
    process.exit(1);
  }
};

/**
 * Gather comprehensive database health information.
 * Works whether the deployment is a replica set, sharded cluster, or Atlas serverless.
 * Never throws - always returns a structured snapshot.
 */
const getDatabaseHealth = async () => {
  const db = mongoose.connection;
  const isConnected = db.readyState === 1;
  const startMs = Date.now();

  if (!isConnected) {
    return {
      connected: false,
      responseTimeMs: null,
      topology: 'unknown',
      isPrimary: false,
      replicaSet: null,
      primary: null,
      hosts: [],
      me: null,
      replicationLag: null,
      replicationStatus: 'unavailable',
    };
  }

  try {
    const hello = await db.db.admin().command({ hello: 1 });
    const responseTimeMs = Date.now() - startMs;

    const setName = hello.setName || null;
    const hosts = hello.hosts || [];
    const me = hello.me || null;
    const primary = hello.primary || null;
    const isPrimary = Boolean(hello.isWritablePrimary);

    // Try to get replication lag from replSetGetStatus (only works on actual replica members)
    let secondaryHosts = [];
    let replicationLag = null;
    let replicationStatus = 'not_applicable';

    if (setName) {
      try {
        const rsStatus = await db.db.admin().command({ replSetGetStatus: 1 });
        const members = rsStatus.members || [];

        const primaryMember = members.find((m) => m.stateStr === 'PRIMARY');
        const secondaryMembers = members.filter((m) => m.stateStr === 'SECONDARY');
        secondaryHosts = secondaryMembers.map((m) => ({
          name: m.name,
          lag: m.optimeDate && primaryMember && primaryMember.optimeDate
            ? Math.max(0, Math.floor((new Date(primaryMember.optimeDate) - new Date(m.optimeDate)) / 1000))
            : null,
        }));

        const maxLag = secondaryHosts.reduce((max, s) => (s.lag !== null ? Math.max(max, s.lag) : max), 0);
        replicationLag = secondaryHosts.length > 0 ? maxLag : null;
        replicationStatus = secondaryMembers.length > 0 ? (maxLag < 60 ? 'healthy' : 'lagging') : 'no_secondaries';
      } catch (_) {
        replicationStatus = 'status_unavailable';
      }
    }

    return {
      connected: true,
      responseTimeMs,
      topology: setName ? 'replicaSet' : (hello.msg === 'isdbgrid' ? 'sharded' : 'standalone'),
      isPrimary,
      replicaSet: setName,
      primary,
      hosts,
      me,
      secondaryHosts,
      replicationLag,
      replicationStatus,
    };
  } catch (err) {
    return {
      connected: false,
      responseTimeMs: Date.now() - startMs,
      topology: 'error',
      isPrimary: false,
      replicaSet: null,
      primary: null,
      hosts: [],
      me: null,
      replicationLag: null,
      replicationStatus: 'error',
      error: err.message,
    };
  }
};

module.exports = connectDB;
module.exports.getDatabaseHealth = getDatabaseHealth;
