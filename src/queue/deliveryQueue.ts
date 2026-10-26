import { WebhookEvent } from '../storage/eventStore';

export type TaskHandler = (event: WebhookEvent) => Promise<void>;

export class DeliveryQueue {
  private queue: WebhookEvent[] = [];
  private isProcessing = false;
  private handler: TaskHandler | null = null;
  private delayedTimers: Set<NodeJS.Timeout> = new Set();

  registerHandler(handler: TaskHandler) {
    this.handler = handler;
  }

  enqueue(event: WebhookEvent) {
    this.queue.push(event);
    this.processNext();
  }

  scheduleRetry(event: WebhookEvent, delayMs: number) {
    const timer = setTimeout(() => {
      this.delayedTimers.delete(timer);
      this.enqueue(event);
    }, delayMs);
    this.delayedTimers.add(timer);
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0 || !this.handler) {
      return;
    }

    this.isProcessing = true;
    const event = this.queue.shift()!;

    try {
      await this.handler(event);
    } catch (err) {
      console.error(`[DeliveryQueue] Unhandled error processing event ${event.id}:`, err);
    } finally {
      this.isProcessing = false;
      // Continue next tick
      setImmediate(() => this.processNext());
    }
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
    for (const t of this.delayedTimers) {
      clearTimeout(t);
    }
    this.delayedTimers.clear();
  }
}

export const deliveryQueue = new DeliveryQueue();
