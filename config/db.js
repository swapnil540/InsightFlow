const mongoose = require('mongoose');
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 30000;
let retryTimer = null;
let retryDelayMs = INITIAL_RETRY_DELAY_MS;
let connectionAttempt = null;

function scheduleReconnect() {
  if (retryTimer || !process.env.MONGODB_URI) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDatabase();
  }, delay);
  retryTimer.unref();
}

async function connectDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn('MONGODB_URI is not set. Database connection skipped.');
    return false;
  }

  if (mongoose.connection.readyState === 1) return true;
  if (connectionAttempt) return connectionAttempt;

  connectionAttempt = (async () => {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });

      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryDelayMs = INITIAL_RETRY_DELAY_MS;
      console.log('MongoDB connected successfully.');
      return true;
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      scheduleReconnect();
      return false;
    } finally {
      connectionAttempt = null;
    }
  })();

  return connectionAttempt;
}

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB.');
});

mongoose.connection.on('error', (error) => {
  console.error('Mongoose connection error:', error.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from MongoDB.');
});

module.exports = { connectDatabase };
