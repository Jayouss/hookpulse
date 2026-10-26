import { Router, Request, Response } from 'express';
import { config } from '../config';
import { eventStore, EventStatus } from '../storage/eventStore';
import { deliveryQueue } from '../queue/deliveryQueue';
import { WebhookSigner } from '../crypto/signer';

export const apiRouter = Router();

// Middleware: API Key Authentication
function requireApiKey(req: Request, res: Response, next: Function) {
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (key !== config.masterApiKey) {
    res.status(401).json({ error: 'Unauthorized', message: 'Valid x-api-key header required' });
    return;
  }
  next();
}

/**
 * 1. Publish Event (Ingest & Queue for Delivery)
 */
apiRouter.post('/events/publish', requireApiKey, (req: Request, res: Response) => {
  const { eventType, destinationUrl, payload, secret, maxAttempts } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!eventType || !destinationUrl || payload === undefined) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Fields `eventType`, `destinationUrl`, and `payload` are required.',
    });
    return;
  }

  const { event, isDuplicate } = eventStore.createEvent({
    eventType,
    destinationUrl,
    payload,
    secret: secret || config.defaultSecret,
    maxAttempts: maxAttempts || config.retryPolicy.maxAttempts,
    idempotencyKey,
  });

  if (isDuplicate) {
    res.status(200).json({
      message: 'Idempotent request: Event already queued or processed.',
      event,
    });
    return;
  }

  // Enqueue for immediate dispatch
  deliveryQueue.enqueue(event);

  res.status(202).json({
    message: 'Event accepted and enqueued for delivery.',
    event,
  });
});

/**
 * 2. List Events & Filter by Status (e.g. DEAD_LETTER, RETRYING, DELIVERED)
 */
apiRouter.get('/events', requireApiKey, (req: Request, res: Response) => {
  const status = req.query.status as EventStatus | undefined;
  const limit = parseInt(req.query.limit as string || '50', 10);
  const events = eventStore.listEvents({ status, limit });

  res.json({
    total: events.length,
    events,
  });
});

/**
 * 3. Inspect Specific Event History
 */
apiRouter.get('/events/:id', requireApiKey, (req: Request, res: Response) => {
  const event = eventStore.getEvent(req.params.id);
  if (!event) {
    res.status(404).json({ error: 'Not Found', message: `Event ${req.params.id} not found.` });
    return;
  }

  res.json(event);
});

/**
 * 4. Manual Replay (Dead Letter Queue Recovery)
 */
apiRouter.post('/events/:id/replay', requireApiKey, (req: Request, res: Response) => {
  const event = eventStore.getEvent(req.params.id);
  if (!event) {
    res.status(404).json({ error: 'Not Found', message: `Event ${req.params.id} not found.` });
    return;
  }

  // Reset attempt count and set status to PENDING
  event.attempts = 0;
  event.status = 'PENDING';
  event.updatedAt = new Date().toISOString();

  deliveryQueue.enqueue(event);

  res.status(202).json({
    message: `Event ${event.id} re-enqueued for delivery.`,
    event,
  });
});

/**
 * 5. Verify Signature Utility
 */
apiRouter.post('/verify', (req: Request, res: Response) => {
  const { payload, signature, secret } = req.body;

  if (!payload || !signature || !secret) {
    res.status(400).json({ error: 'Bad Request', message: 'payload, signature, and secret required' });
    return;
  }

  const isValid = WebhookSigner.verify(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    signature,
    secret
  );

  res.json({ valid: isValid });
});

/**
 * 6. System Metrics & Queue Telemetry
 */
apiRouter.get('/metrics', (_req: Request, res: Response) => {
  const metrics = eventStore.getMetrics();
  res.json({
    ...metrics,
    queueDepth: deliveryQueue.getQueueDepth(),
    timestamp: new Date().toISOString(),
  });
});
