import { DatabaseService } from './database.service';
import { ApiService } from './api.service';
import { MeasurementBatch, SyncStatus } from '../types';
import { SyncConfig } from '../config/sync.config';

export class SyncService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isSyncing: boolean = false;
  private static listeners: ((status: SyncStatus) => void)[] = [];

  /**
   * Start background sync worker
   * Runs every SYNC_INTERVAL_MS and sends max MAX_BATCH_SIZE measurements per batch
   */
  static startSync(intervalMs: number = SyncConfig.SYNC_INTERVAL_MS): void {
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
   * Sends up to MAX_BATCH_SIZE measurements per cycle
   */
  static async syncOnce(): Promise<void> {
    // Prevent concurrent syncs
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;

    try {
      // Get unsynced measurements from SQLite (limit to MAX_BATCH_SIZE)
      const measurements = await DatabaseService.getUnsyncedMeasurements(SyncConfig.MAX_BATCH_SIZE);
      
      if (measurements.length === 0) {
        // No measurements to sync
        this.emitStatus({ status: 'idle' });
        return;
      }

      console.log(`🔄 Syncing ${measurements.length} measurements (max batch size: ${SyncConfig.MAX_BATCH_SIZE})...`);
      this.emitStatus({ 
        status: 'syncing', 
        message: `Odesílám ${measurements.length} měření...`,
        timestamp: Date.now()
      });

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
          this.emitStatus({ 
            status: 'success', 
            message: `Dávka odeslána (${sessionMeasurements.length} měření)`,
            timestamp: Date.now()
          });
        } catch (error) {
          console.error(`✗ Failed to sync session ${sessionId}:`, error);
          this.emitStatus({ 
            status: 'error', 
            message: 'Server nedostupný',
            timestamp: Date.now()
          });
          // Don't throw - let other sessions continue syncing
        }
      }

      // Clean up synced measurements if configured
      if (SyncConfig.DELETE_SYNCED_IMMEDIATELY) {
        await DatabaseService.deleteSynced();
      }
      
      // Check if there are more measurements to sync
      const remainingStats = await DatabaseService.getStats();
      if (remainingStats.unsynced > 0) {
        console.log(`ℹ️ ${remainingStats.unsynced} measurements still pending sync (will be sent in next cycle)`);
        this.emitStatus({ 
          status: 'success', 
          message: `Dávka odeslána. Zbývá ${remainingStats.unsynced} měření...`,
          timestamp: Date.now()
        });
      } else {
        console.log('✓ All measurements synced');
        this.emitStatus({ 
          status: 'success', 
          message: 'Vše synchronizováno',
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('Sync error:', error);
      this.emitStatus({ 
        status: 'error', 
        message: 'Chyba synchronizace',
        timestamp: Date.now()
      });
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

  /**
   * Subscribe to sync status updates
   */
  static subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit sync status to all listeners
   */
  private static emitStatus(status: SyncStatus): void {
    this.listeners.forEach(listener => listener(status));
  }
}
