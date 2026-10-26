import test from 'node:test';
import assert from 'node:assert';
import { WebhookSigner } from '../src/crypto/signer';
import { EventStore } from '../src/storage/eventStore';

test('WebhookSigner - generates and verifies valid HMAC-SHA256 signature', () => {
  const payload = JSON.stringify({ event: 'order.completed', amount: 5000 });
  const secret = 'whsec_test_secret_key_12345';
  
  const signatureHeader = WebhookSigner.sign(payload, secret);
  assert.ok(signatureHeader.includes('t='));
  assert.ok(signatureHeader.includes('v1='));

  const isValid = WebhookSigner.verify(payload, signatureHeader, secret);
  assert.strictEqual(isValid, true);
});

test('WebhookSigner - rejects tampered payload', () => {
  const originalPayload = JSON.stringify({ amount: 100 });
  const tamperedPayload = JSON.stringify({ amount: 9999 });
  const secret = 'whsec_test_secret_key_12345';

  const signature = WebhookSigner.sign(originalPayload, secret);
  const isValid = WebhookSigner.verify(tamperedPayload, signature, secret);
  assert.strictEqual(isValid, false);
});

test('WebhookSigner - rejects expired signature', () => {
  const payload = JSON.stringify({ test: true });
  const secret = 'whsec_test_secret_key_12345';
  const pastTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

  const signature = WebhookSigner.sign(payload, secret, pastTimestamp);
  const isValid = WebhookSigner.verify(payload, signature, secret, 300); // 5 min tolerance
  assert.strictEqual(isValid, false);
});

test('EventStore - idempotency check prevents duplicate events', () => {
  const store = new EventStore();
  const idempotencyKey = 'idem_key_unique_test_123';

  const first = store.createEvent({
    eventType: 'user.created',
    destinationUrl: 'http://example.com/webhook',
    payload: { id: 1 },
    secret: 'whsec_test',
    maxAttempts: 3,
    idempotencyKey,
  });

  assert.strictEqual(first.isDuplicate, false);

  const second = store.createEvent({
    eventType: 'user.created',
    destinationUrl: 'http://example.com/webhook',
    payload: { id: 1 },
    secret: 'whsec_test',
    maxAttempts: 3,
    idempotencyKey,
  });

  assert.strictEqual(second.isDuplicate, true);
  assert.strictEqual(second.event.id, first.event.id);
});

test('EventStore - records delivery history accurately', () => {
  const store = new EventStore();
  const { event } = store.createEvent({
    eventType: 'payment.failed',
    destinationUrl: 'http://example.com/webhook',
    payload: {},
    secret: 'whsec_test',
    maxAttempts: 3,
  });

  store.recordAttempt(
    event.id,
    {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      statusCode: 500,
      latencyMs: 120,
      success: false,
      error: 'HTTP 500',
    },
    'RETRYING'
  );

  const updated = store.getEvent(event.id);
  assert.strictEqual(updated?.attempts, 1);
  assert.strictEqual(updated?.status, 'RETRYING');
  assert.strictEqual(updated?.deliveryHistory.length, 1);
});
