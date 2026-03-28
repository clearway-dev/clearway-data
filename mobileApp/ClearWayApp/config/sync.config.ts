/**
 * Sync Service Configuration
 * 
 * Centralized configuration for data synchronization
 */

export const SyncConfig = {
  /**
   * Maximum number of measurements to send in a single batch
   * This prevents backend overload and ensures reliable data transfer
   * 
   * @default 1500
   */
  MAX_BATCH_SIZE: 1500,

  /**
   * Sync interval in milliseconds
   * How often the background worker checks for unsynced measurements
   * 
   * @default 10000 (10 seconds)
   */
  SYNC_INTERVAL_MS: 10000,

  /**
   * How long to wait before retrying after a failed sync (in milliseconds)
   * 
   * @default 30000 (30 seconds)
   */
  RETRY_DELAY_MS: 30000,

  /**
   * Whether to delete synced measurements immediately after successful sync
   * If false, they remain in the database for local analytics
   * 
   * @default true
   */
  DELETE_SYNCED_IMMEDIATELY: true,
} as const;
