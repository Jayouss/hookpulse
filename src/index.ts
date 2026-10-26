import express from 'express';
import cors from 'cors';
import { config } from './config';
import { apiRouter } from './routes/api';
import { deliveryQueue } from './queue/deliveryQueue';
import { DispatcherWorker } from './dispatcher/worker';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Register delivery handler to the task queue
deliveryQueue.registerHandler(DispatcherWorker.handleDelivery);

// Health check (Public)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'HookPulse Webhook Relay',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Root Information
app.get('/', (_req, res) => {
  res.json({
    service: 'HookPulse Resilient Webhook Relay',
    version: '0.1.0',
    status: 'operational',
    docs: {
      auth: 'Send header `x-api-key: hp_live_master_key_secret_2026`',
      routes: [
        'POST /api/v1/events/publish',
        'GET  /api/v1/events',
        'GET  /api/v1/events/:id',
        'POST /api/v1/events/:id/replay',
        'POST /api/v1/verify',
        'GET  /api/v1/metrics',
      ],
    },
  });
});

// Mount API routes
app.use('/api/v1', apiRouter);

// Start Server
const server = app.listen(config.port, config.host, () => {
  console.log(`====================================================`);
  console.log(`⚡ HookPulse Webhook Relay running on http://${config.host}:${config.port}`);
  console.log(`🔁 Max Retries: ${config.retryPolicy.maxAttempts} | Initial Backoff: ${config.retryPolicy.initialBackoffMs}ms`);
  console.log(`🔑 Master API Key: ${config.masterApiKey.substring(0, 10)}...`);
  console.log(`====================================================`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Draining queue...');
  server.close(() => {
    deliveryQueue.clear();
    console.log('HookPulse shutdown complete.');
  });
});
