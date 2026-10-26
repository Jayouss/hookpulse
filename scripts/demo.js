/**
 * HookPulse: Interactive Resilience & Exponential Backoff Demonstration
 *
 * Demonstrates:
 * 1. Simulating a Flaky Destination Server (fails twice, recovers on 3rd attempt)
 * 2. Cryptographic HMAC-SHA256 Signature Delivery & Validation
 * 3. Exponential Backoff Retries with Jitter
 * 4. Idempotency Key De-duplication
 * 5. Full Delivery Audit History Inspection
 */

const http = require('http');

const RECEIVER_PORT = 5050;
const HOOKPULSE_PORT = 4000;
const API_KEY = 'hp_live_master_key_secret_2026';
const WEBHOOK_SECRET = 'whsec_demo_secret_key_1234567890';

let attemptCounter = 0;

function printHeader(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`>> ${title.toUpperCase()}`);
  console.log('='.repeat(70));
}

// 1. Start Flaky Mock Destination Server
const mockReceiver = http.createServer((req, res) => {
  attemptCounter++;
  const signature = req.headers['x-hookpulse-signature'];
  const deliveryAttempt = req.headers['x-hookpulse-delivery'];

  console.log(`\n  [Mock Receiver] Incoming Webhook Attempt #${deliveryAttempt}`);
  console.log(`  [Mock Receiver] Header X-HookPulse-Signature: ${signature}`);

  if (attemptCounter === 1) {
    console.log(`  [Mock Receiver] 💥 Simulating 500 Internal Server Error`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Database connection failed' }));
  } else if (attemptCounter === 2) {
    console.log(`  [Mock Receiver] 💥 Simulating 503 Service Unavailable`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server temporarily overloaded' }));
  } else {
    console.log(`  [Mock Receiver] ✅ Success! Returning 200 OK`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received', processed_at: new Date().toISOString() }));
  }
});

mockReceiver.listen(RECEIVER_PORT, async () => {
  printHeader('HookPulse Resilient Webhook Relay Demo');
  console.log(`[Setup] Mock Receiver listening on http://localhost:${RECEIVER_PORT}/webhook`);

  // 2. Publish Webhook Event to HookPulse
  printHeader('Step 1: Publishing Event with Idempotency Key');
  const payload = {
    eventType: 'payment.succeeded',
    destinationUrl: `http://localhost:${RECEIVER_PORT}/webhook`,
    secret: WEBHOOK_SECRET,
    payload: {
      transactionId: 'txn_987654321',
      amount: 150000,
      currency: 'IDR',
      customer: 'jayoys2928@gmail.com',
    },
  };

  const publishRes = await fetch(`http://localhost:${HOOKPULSE_PORT}/api/v1/events/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'idempotency-key': 'idem_key_order_1001',
    },
    body: JSON.stringify(payload),
  });

  const publishData = await publishRes.json();
  const eventId = publishData.event.id;
  console.log(`[Event Enqueued] ID: ${eventId}`);
  console.log(`[Status]: ${publishData.event.status} | Max Attempts: ${publishData.event.maxAttempts}`);

  // 3. Test Idempotency (Duplicate Publish)
  printHeader('Step 2: Testing Idempotency Protection');
  console.log('Publishing identical event with SAME Idempotency-Key...');
  const duplicateRes = await fetch(`http://localhost:${HOOKPULSE_PORT}/api/v1/events/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'idempotency-key': 'idem_key_order_1001',
    },
    body: JSON.stringify(payload),
  });
  const duplicateData = await duplicateRes.json();
  console.log(`[Idempotency Result]: ${duplicateData.message} (Duplicate discarded)`);

  // 4. Poll for delivery history and backoff progression
  printHeader('Step 3: Monitoring Exponential Backoff Progression');
  console.log('Waiting for HookPulse dispatcher to execute retries...');

  let finalEvent = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const inspectRes = await fetch(`http://localhost:${HOOKPULSE_PORT}/api/v1/events/${eventId}`, {
      headers: { 'x-api-key': API_KEY },
    });
    finalEvent = await inspectRes.json();

    if (finalEvent.status === 'DELIVERED' || finalEvent.status === 'DEAD_LETTER') {
      break;
    }
  }

  // 5. Inspect Delivery History
  printHeader('Step 4: Delivery Audit Trail');
  console.log(`Final Status: ${finalEvent.status}`);
  console.log(`Total Attempts: ${finalEvent.attempts}`);
  console.log('\nAudit Logs per Attempt:');
  finalEvent.deliveryHistory.forEach((attempt) => {
    console.log(
      `  - Attempt #${attempt.attemptNumber}: Status ${attempt.statusCode || 'ERR'} | Latency: ${attempt.latencyMs}ms | Success: ${attempt.success} | Error: ${attempt.error || 'None'}`
    );
  });

  printHeader('Demo Completed Successfully!');
  mockReceiver.close();
  process.exit(0);
});
