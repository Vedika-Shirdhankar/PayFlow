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
    // startSession() alone succeeds on a standalone server, so check the topology.
    const hello = await conn.connection.db.admin().command({ hello: 1 });
    const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
    if (!supportsTransactions) {
      throw new Error(
        'MongoDB is running standalone, but PayFlow needs transactions. ' +
          'Use MongoDB Atlas or start a local replica set before starting the app.'
      );
    }
    console.log(`MongoDB transactions supported (${hello.setName ? `replica set "${hello.setName}"` : 'sharded cluster'}).`);

    return conn;
  } catch (error) {
    console.error(`MongoDB Connection Failure Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
