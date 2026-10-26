import crypto from 'crypto';

export class WebhookSigner {
  /**
   * Generates standard HMAC-SHA256 signature header:
   * "t={timestamp},v1={signature_hex}"
   */
  static sign(payload: string, secret: string, timestamp?: number): string {
    const t = timestamp || Math.floor(Date.now() / 1000);
    const signaturePayload = `${t}.${payload}`;
    
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(signaturePayload);
    const signature = hmac.digest('hex');

    return `t=${t},v1=${signature}`;
  }

  /**
   * Verifies signature header against payload and secret with tolerance check.
   */
  static verify(
    payload: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds: number = 300
  ): boolean {
    if (!signatureHeader) return false;

    // Parse header "t=...,v1=..."
    const parts = signatureHeader.split(',');
    let timestamp: number | null = null;
    let signature: string | null = null;

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = parseInt(value, 10);
      if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) return false;

    // Check timestamp freshness to prevent replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return false;
    }

    // Compute expected signature
    const signaturePayload = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(signaturePayload);
    const expectedSignature = hmac.digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}
