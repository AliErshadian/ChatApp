import { SetMetadata } from '@nestjs/common';

export const WS_RATE_LIMIT_META = 'ws_rate_limit';

export interface WsRateLimitOptions {
  /**
   * Logical action name used in the Redis key.
   * Example: "message_send", "typing".
   */
  action: string;
  /**
   * Maximum tokens in the bucket.
   */
  capacity: number;
  /**
   * Tokens added per second.
   */
  refillPerSec: number;
  /**
   * Optional: additional key suffix (e.g. conversationId).
   */
  keySuffixFromBody?: (body: any) => string | undefined;
}

export function WsRateLimit(options: WsRateLimitOptions) {
  return SetMetadata(WS_RATE_LIMIT_META, options);
}

