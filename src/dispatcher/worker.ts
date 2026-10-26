import { config } from '../config';
import { WebhookSigner } from '../crypto/signer';
import { eventStore, WebhookEvent, DeliveryAttempt, EventStatus } from '../storage/eventStore';
import { deliveryQueue } from '../queue/deliveryQueue';

export class DispatcherWorker {
  static async handleDelivery(event: WebhookEvent): Promise<void> {
    const attemptNumber = event.attempts + 1;
    const startTime = Date.now();
    const payloadStr = JSON.stringify(event.payload);

    // Generate cryptographic signature
    const signatureHeader = WebhookSigner.sign(payloadStr, event.secret);

    let statusCode: number | undefined;
    let errorMessage: string | undefined;
    let success = false;

    try {
      const response = await fetch(event.destinationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HookPulse-Event': event.eventType,
          'X-HookPulse-Delivery': attemptNumber.toString(),
          'X-HookPulse-Signature': signatureHeader,
          'User-Agent': 'HookPulse-Relay/0.1.0',
        },
        body: payloadStr,
        signal: AbortSignal.timeout(config.retryPolicy.timeoutMs),
      });

      statusCode = response.status;
      success = response.ok; // 200-299

      if (!success) {
        errorMessage = `HTTP error: Received status ${statusCode}`;
      }
    } catch (err: any) {
      success = false;
      errorMessage = err.name === 'TimeoutError' ? 'Request timed out' : err.message;
    }

    const latencyMs = Date.now() - startTime;

    const attempt: DeliveryAttempt = {
      attemptNumber,
      timestamp: new Date().toISOString(),
      statusCode,
      latencyMs,
      success,
      error: errorMessage,
    };

    if (success) {
      eventStore.recordAttempt(event.id, attempt, 'DELIVERED');
      console.log(`[Dispatcher] Event ${event.id} (${event.eventType}) successfully delivered on attempt ${attemptNumber} (${latencyMs}ms).`);
      return;
    }

    // Handle failure
    if (attemptNumber < event.maxAttempts) {
      // Calculate Exponential Backoff with Jitter
      const policy = config.retryPolicy;
      const baseDelay = policy.initialBackoffMs * Math.pow(policy.multiplier, attemptNumber - 1);
      const cappedDelay = Math.min(baseDelay, policy.maxBackoffMs);
      const jitter = Math.floor(Math.random() * 200); // 0-200ms random jitter
      const nextDelayMs = cappedDelay + jitter;

      eventStore.recordAttempt(event.id, attempt, 'RETRYING');
      console.warn(
        `[Dispatcher] Event ${event.id} failed (attempt ${attemptNumber}/${event.maxAttempts}): ${errorMessage}. Retrying in ${nextDelayMs}ms.`
      );

      // Re-queue after delay
      deliveryQueue.scheduleRetry(event, nextDelayMs);
    } else {
      // Exhausted retries -> Route to Dead Letter Queue (DLQ)
      eventStore.recordAttempt(event.id, attempt, 'DEAD_LETTER');
      console.error(
        `[Dispatcher] Event ${event.id} exhausted all ${event.maxAttempts} attempts. Moved to DEAD LETTER QUEUE (DLQ).`
      );
    }
  }
}
