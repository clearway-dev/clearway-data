/**
 * API Configuration
 * 
 * Centralized configuration for API calls and timeouts
 */

export const ApiConfig = {
  /**
   * Default timeout for GET requests (in milliseconds)
   * @default 10000 (10 seconds)
   */
  DEFAULT_TIMEOUT_MS: 10000,

  /**
   * Timeout for POST/PUT requests with larger payloads (in milliseconds)
   * @default 15000 (15 seconds)
   */
  UPLOAD_TIMEOUT_MS: 15000,

  /**
   * Timeout for batch upload operations (in milliseconds)
   * @default 30000 (30 seconds)
   */
  BATCH_TIMEOUT_MS: 30000,
} as const;
