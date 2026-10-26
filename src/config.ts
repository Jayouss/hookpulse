import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  masterApiKey: process.env.MASTER_API_KEY || 'hp_live_master_key_secret_2026',
  defaultSecret: process.env.DEFAULT_WEBHOOK_SECRET || 'whsec_hookpulse_default_hmac_secret_key_32chars',
  retryPolicy: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '4', 10),
    initialBackoffMs: parseInt(process.env.INITIAL_BACKOFF_MS || '1000', 10),
    multiplier: parseFloat(process.env.BACKOFF_MULTIPLIER || '2.0'),
    maxBackoffMs: parseInt(process.env.MAX_BACKOFF_MS || '30000', 10),
    timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '5000', 10),
  },
};
