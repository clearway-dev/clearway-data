import { DatabaseService } from './database.service';
import { ApiService, ApiError } from './api.service';
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
   * Processes sessions one by one, sending up to MAX_BATCH_SIZE measurements per session
   */
  static async syncOnce(): Promise<void> {
    // Prevent concurrent syncs
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;

    try {
      // Step 1: Get all unique session IDs with unsynced measurements (ordered by oldest first)
      const unsyncedSessions = await DatabaseService.getUnsyncedSessionIds();
      
      if (unsyncedSessions.length === 0) {
        // No measurements to sync
        this.emitStatus({ status: 'idle' });
        return;
      }

      console.log(`🔄 Found ${unsyncedSessions.length} session(s) with unsynced data`);

      let totalSynced = 0;
      let totalFailed = 0;
      let totalPoisonPills = 0;

      // Step 2: Process each session one by one
      for (const sessionId of unsyncedSessions) {
        try {
          // Get unsynced measurements for this session only (limit to MAX_BATCH_SIZE)
          const measurements = await DatabaseService.getUnsyncedMeasurementsBySession(
            sessionId, 
            SyncConfig.MAX_BATCH_SIZE
          );

          if (measurements.length === 0) {
            console.log(`⚠️ Session ${sessionId}: No measurements found (race condition?)`);
            continue;
          }

          console.log(`📦 Session ${sessionId}: Syncing ${measurements.length} measurements (max: ${SyncConfig.MAX_BATCH_SIZE})...`);
          
          this.emitStatus({ 
            status: 'syncing', 
            message: `Odesílám session ${sessionId.substring(0, 8)}... (${measurements.length} měření)`,
            timestamp: Date.now()
          });

          // Build batch for this session
          const batch: MeasurementBatch = {
            session_id: sessionId,
            measurements: measurements.map(m => ({
              measured_at: m.measured_at,
              latitude: m.latitude,
              longitude: m.longitude,
              distance_left: m.distance_left,
              distance_right: m.distance_right,
              speed: m.speed,
              accuracy_gps: m.accuracy_gps,
            })),
          };

          // Send to backend
          await ApiService.sendBatch(batch);
          
          // ✅ SUCCESS: Delete measurements immediately (Garbage Collector)
          const ids = measurements.map(m => m.id);
          await DatabaseService.deleteMeasurements(ids);
          
          totalSynced += measurements.length;
          console.log(`✓ Session ${sessionId}: ${measurements.length} measurements synced and deleted`);
          
          this.emitStatus({ 
            status: 'success', 
            message: `Session ${sessionId.substring(0, 8)}... odeslána (${measurements.length} měření)`,
            timestamp: Date.now()
          });

        } catch (error) {
          // Check if this is a Poison Pill (4xx error)
          if (error instanceof ApiError && error.isPoisonPill()) {
            // Mark as error in database (synced = -1)
            const measurements = await DatabaseService.getUnsyncedMeasurementsBySession(sessionId, SyncConfig.MAX_BATCH_SIZE);
            const ids = measurements.map(m => m.id);
            
            await DatabaseService.markAsError(ids, error.message);
            
            totalPoisonPills += measurements.length;
            console.error(`☠️ Session ${sessionId}: Poison pill detected (${error.statusCode}) - ${measurements.length} measurements marked as error`);
            
            this.emitStatus({ 
              status: 'error', 
              message: `Session ${sessionId.substring(0, 8)}... - chyba dat (${error.statusCode})`,
              timestamp: Date.now()
            });
          } else {
            // Server error (5xx) or network error - will retry later
            totalFailed++;
            console.error(`✗ Failed to sync session ${sessionId}:`, error);
            this.emitStatus({ 
              status: 'error', 
              message: `Session ${sessionId.substring(0, 8)}... - server nedostupný`,
              timestamp: Date.now()
            });
          }
          // Don't throw - let other sessions continue syncing
        }
      }

      // Check if there are more measurements to sync
      const remainingStats = await DatabaseService.getStats();
      
      if (totalSynced > 0 || totalPoisonPills > 0) {
        console.log(`✓ Sync completed: ${totalSynced} synced & deleted, ${totalPoisonPills} poison pills, ${totalFailed} sessions failed`);
      }
      
      if (remainingStats.unsynced > 0) {
        console.log(`ℹ️ ${remainingStats.unsynced} measurements still pending sync (will be sent in next cycle)`);
        this.emitStatus({ 
          status: 'success', 
          message: `Dávka odeslána. Zbývá ${remainingStats.unsynced} měření...`,
          timestamp: Date.now()
        });
      } else if (remainingStats.errors > 0) {
        console.log(`⚠️ All valid measurements synced. ${remainingStats.errors} error records (poison pills) remain.`);
        this.emitStatus({ 
          status: 'success', 
          message: `Synchronizováno. ${remainingStats.errors} chybných záznamů.`,
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
