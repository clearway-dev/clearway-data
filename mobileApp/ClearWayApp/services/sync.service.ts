import { DatabaseService } from './database.service';
import { ApiService } from './api.service';
import { MeasurementBatch } from '../types';

export class SyncService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isSyncing: boolean = false;

  /**
   * Start background sync worker
   * Runs every 10 seconds and sends max 100 measurements per batch
   */
  static startSync(intervalMs: number = 10000): void {
    if (this.intervalId) {
      console.warn('Sync already running');
      return;
    }

    console.log('🔄 Starting background sync worker');
    
    // Run immediately on start
    this.syncOnce();
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.syncOnce();
    }, intervalMs);
  }

  /**
   * Stop background sync worker
   */
  static stopSync(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏸ Background sync stopped');
    }
  }

  /**
   * Perform one sync cycle
   */
  static async syncOnce(): Promise<void> {
    // Prevent concurrent syncs
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;

    try {
      // Get unsynced measurements from SQLite
      const measurements = await DatabaseService.getUnsyncedMeasurements(100);
      
      if (measurements.length === 0) {
        // No measurements to sync
        return;
      }

      console.log(`🔄 Syncing ${measurements.length} measurements...`);

      // Group by session_id (there should be only one active session)
      const groupedBySession = measurements.reduce((acc, m) => {
        if (!acc[m.session_id]) {
          acc[m.session_id] = [];
        }
        acc[m.session_id].push(m);
        return acc;
      }, {} as Record<string, typeof measurements>);

      // Send batch for each session
      for (const [sessionId, sessionMeasurements] of Object.entries(groupedBySession)) {
        const batch: MeasurementBatch = {
          session_id: sessionId,
          measurements: sessionMeasurements.map(m => ({
            measured_at: m.measured_at,
            latitude: m.latitude,
            longitude: m.longitude,
            distance_left: m.distance_left,
            distance_right: m.distance_right,
            speed: m.speed,
            accuracy_gps: m.accuracy_gps,
          })),
        };

        try {
          // Send to backend
          await ApiService.sendBatch(batch);
          
          // Mark as synced in local DB
          const ids = sessionMeasurements.map(m => m.id);
          await DatabaseService.markAsSynced(ids);
          
          console.log(`✓ Session ${sessionId}: ${sessionMeasurements.length} measurements synced`);
        } catch (error) {
          console.error(`✗ Failed to sync session ${sessionId}:`, error);
          // Don't throw - let other sessions continue syncing
        }
      }

      // Optional: Clean up old synced measurements
      await DatabaseService.deleteSynced();
      
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Force immediate sync (manual trigger)
   */
  static async forceSync(): Promise<void> {
    await this.syncOnce();
  }
}
