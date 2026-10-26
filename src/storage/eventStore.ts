import crypto from 'crypto';

export type EventStatus = 'PENDING' | 'DELIVERED' | 'RETRYING' | 'DEAD_LETTER';

export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: string;
  statusCode?: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface WebhookEvent {
  id: string;
  eventType: string;
  destinationUrl: string;
  payload: any;
  secret: string;
  status: EventStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  deliveryHistory: DeliveryAttempt[];
}

export class EventStore {
  private events: Map<string, WebhookEvent> = new Map();
  private idempotencyIndex: Map<string, string> = new Map();

  createEvent(params: {
    eventType: string;
    destinationUrl: string;
    payload: any;
    secret: string;
    maxAttempts: number;
    idempotencyKey?: string;
  }): { event: WebhookEvent; isDuplicate: boolean } {
    // Idempotency check
    if (params.idempotencyKey && this.idempotencyIndex.has(params.idempotencyKey)) {
      const existingId = this.idempotencyIndex.get(params.idempotencyKey)!;
      const existingEvent = this.events.get(existingId)!;
      return { event: existingEvent, isDuplicate: true };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const event: WebhookEvent = {
      id,
      eventType: params.eventType,
      destinationUrl: params.destinationUrl,
      payload: params.payload,
      secret: params.secret,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: params.maxAttempts,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      deliveryHistory: [],
    };

    this.events.set(id, event);
    if (params.idempotencyKey) {
      this.idempotencyIndex.set(params.idempotencyKey, id);
    }

    return { event, isDuplicate: false };
  }

  getEvent(id: string): WebhookEvent | undefined {
    return this.events.get(id);
  }

  listEvents(filters?: { status?: EventStatus; limit?: number }): WebhookEvent[] {
    let list = Array.from(this.events.values());
    if (filters?.status) {
      list = list.filter((e) => e.status === filters.status);
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list.slice(0, filters?.limit || 50);
  }

  recordAttempt(id: string, attempt: DeliveryAttempt, newStatus: EventStatus): WebhookEvent | undefined {
    const event = this.events.get(id);
    if (!event) return undefined;

    event.attempts += 1;
    event.status = newStatus;
    event.updatedAt = new Date().toISOString();
    event.deliveryHistory.push(attempt);

    if (newStatus === 'DELIVERED') {
      event.deliveredAt = attempt.timestamp;
    }

    this.events.set(id, event);
    return event;
  }

  getMetrics() {
    const total = this.events.size;
    let delivered = 0;
    let deadLetter = 0;
    let retrying = 0;
    let pending = 0;

    for (const e of this.events.values()) {
      if (e.status === 'DELIVERED') delivered++;
      else if (e.status === 'DEAD_LETTER') deadLetter++;
      else if (e.status === 'RETRYING') retrying++;
      else if (e.status === 'PENDING') pending++;
    }

    return {
      totalEvents: total,
      delivered,
      deadLetter,
      retrying,
      pending,
      successRatePct: total > 0 ? parseFloat(((delivered / total) * 100).toFixed(2)) : 100.0,
    };
  }
}

export const eventStore = new EventStore();
