import * as SQLite from 'expo-sqlite';
import { LocalMeasurement } from '../types';

export class DatabaseService {
  private static db: SQLite.SQLiteDatabase | null = null;

  /**
   * Initialize SQLite database
   */
  static async initialize(): Promise<void> {
    try {
      this.db = await SQLite.openDatabaseAsync('clearway.db');
      
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS local_measurements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          measured_at TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          distance_left REAL NOT NULL,
          distance_right REAL NOT NULL,
          speed REAL,
          accuracy_gps REAL,
          synced INTEGER DEFAULT 0,
          error_message TEXT,
          error_at TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_synced ON local_measurements(synced);
        CREATE INDEX IF NOT EXISTS idx_session ON local_measurements(session_id);
      `);

      // Lightweight migration for existing DBs created before speed/accuracy/error fields.
      const columns = await this.db.getAllAsync<{ name: string }>('PRAGMA table_info(local_measurements)');
      const columnNames = new Set(columns.map((c) => c.name));

      if (!columnNames.has('speed')) {
        await this.db.execAsync('ALTER TABLE local_measurements ADD COLUMN speed REAL;');
      }

      if (!columnNames.has('accuracy_gps')) {
        await this.db.execAsync('ALTER TABLE local_measurements ADD COLUMN accuracy_gps REAL;');
      }

      if (!columnNames.has('error_message')) {
        await this.db.execAsync('ALTER TABLE local_measurements ADD COLUMN error_message TEXT;');
      }

      if (!columnNames.has('error_at')) {
        await this.db.execAsync('ALTER TABLE local_measurements ADD COLUMN error_at TEXT;');
      }
      
      console.log('✓ Database initialized');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Insert measurement into local database
   */
  static async insertMeasurement(measurement: Omit<LocalMeasurement, 'id' | 'synced' | 'error_message' | 'error_at'>): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      await this.db.runAsync(
        `INSERT INTO local_measurements 
         (session_id, measured_at, latitude, longitude, distance_left, distance_right, speed, accuracy_gps, synced) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          measurement.session_id,
          measurement.measured_at,
          measurement.latitude,
          measurement.longitude,
          measurement.distance_left,
          measurement.distance_right,
          measurement.speed,
          measurement.accuracy_gps,
        ]
      );
    } catch (error) {
      console.error('Failed to insert measurement:', error);
      throw error;
    }
  }

  /**
   * Get all unique session IDs that have unsynced measurements
   * Ordered by oldest measurement first (FIFO)
   * Excludes sessions with only error records (synced = -1)
   */
  static async getUnsyncedSessionIds(): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<{ session_id: string }>(
        `SELECT session_id, MIN(measured_at) as oldest_measurement
         FROM local_measurements 
         WHERE synced = 0 
         GROUP BY session_id
         ORDER BY oldest_measurement ASC`
      );
      
      return result.map(r => r.session_id);
    } catch (error) {
      console.error('Failed to fetch unsynced session IDs:', error);
      throw error;
    }
  }

  /**
   * Get unsynced measurements for a specific session
   * @param sessionId - The session ID to fetch measurements for
   * @param limit - Maximum number of measurements to fetch (default 1500)
   */
  static async getUnsyncedMeasurementsBySession(sessionId: string, limit: number = 1500): Promise<LocalMeasurement[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<LocalMeasurement>(
        `SELECT * FROM local_measurements 
         WHERE synced = 0 AND session_id = ? 
         ORDER BY measured_at ASC 
         LIMIT ?`,
        [sessionId, limit]
      );
      
      return result;
    } catch (error) {
      console.error('Failed to fetch unsynced measurements by session:', error);
      throw error;
    }
  }

  /**
   * Get unsynced measurements (max limit)
   * @deprecated Use getUnsyncedSessionIds() and getUnsyncedMeasurementsBySession() instead
   */
  static async getUnsyncedMeasurements(limit: number = 100): Promise<LocalMeasurement[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<LocalMeasurement>(
        'SELECT * FROM local_measurements WHERE synced = 0 ORDER BY measured_at ASC LIMIT ?',
        [limit]
      );
      
      return result;
    } catch (error) {
      console.error('Failed to fetch unsynced measurements:', error);
      throw error;
    }
  }

  /**
   * Mark measurements as synced
   * @deprecated Use deleteMeasurements() instead - we now delete synced data immediately
   */
  static async markAsSynced(ids: number[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (ids.length === 0) return;

    try {
      const placeholders = ids.map(() => '?').join(',');
      await this.db.runAsync(
        `UPDATE local_measurements SET synced = 1 WHERE id IN (${placeholders})`,
        ids
      );
      
      console.log(`✓ Marked ${ids.length} measurements as synced`);
    } catch (error) {
      console.error('Failed to mark measurements as synced:', error);
      throw error;
    }
  }

  /**
   * Mark measurements as failed (poison pill)
   * Sets synced = -1 to prevent infinite retry loops
   */
  static async markAsError(ids: number[], errorMessage: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (ids.length === 0) return;

    try {
      const placeholders = ids.map(() => '?').join(',');
      const errorAt = new Date().toISOString();
      
      await this.db.runAsync(
        `UPDATE local_measurements 
         SET synced = -1, error_message = ?, error_at = ? 
         WHERE id IN (${placeholders})`,
        [errorMessage, errorAt, ...ids]
      );
      
      console.log(`⚠️ Marked ${ids.length} measurements as error (poison pill)`);
    } catch (error) {
      console.error('Failed to mark measurements as error:', error);
      throw error;
    }
  }

  /**
   * Delete measurements by IDs (used after successful sync)
   * This is the Garbage Collector - removes data immediately after server confirms receipt
   */
  static async deleteMeasurements(ids: number[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (ids.length === 0) return;

    try {
      const placeholders = ids.map(() => '?').join(',');
      const result = await this.db.runAsync(
        `DELETE FROM local_measurements WHERE id IN (${placeholders})`,
        ids
      );
      
      console.log(`🗑️ Deleted ${result.changes} measurements (garbage collected)`);
    } catch (error) {
      console.error('Failed to delete measurements:', error);
      throw error;
    }
  }

  /**
   * Delete synced measurements (cleanup)
   */
  static async deleteSynced(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'DELETE FROM local_measurements WHERE synced = 1'
      );
      
      console.log(`✓ Deleted ${result.changes} synced measurements`);
    } catch (error) {
      console.error('Failed to delete synced measurements:', error);
      throw error;
    }
  }

  /**
   * Get total count of measurements in database
   */
  static async getStats(): Promise<{ total: number; unsynced: number; errors: number }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const totalResult = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM local_measurements'
      );
      
      const unsyncedResult = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM local_measurements WHERE synced = 0'
      );
      
      const errorsResult = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM local_measurements WHERE synced = -1'
      );
      
      return {
        total: totalResult?.count || 0,
        unsynced: unsyncedResult?.count || 0,
        errors: errorsResult?.count || 0,
      };
    } catch (error) {
      console.error('Failed to get database stats:', error);
      throw error;
    }
  }

  /**
   * Get error records (poison pills) for debugging
   */
  static async getErrorRecords(limit: number = 100): Promise<LocalMeasurement[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<LocalMeasurement>(
        'SELECT * FROM local_measurements WHERE synced = -1 ORDER BY error_at DESC LIMIT ?',
        [limit]
      );
      
      return result;
    } catch (error) {
      console.error('Failed to fetch error records:', error);
      throw error;
    }
  }

  /**
   * Clear all error records (poison pills)
   * Use this to give failed measurements another chance after fixing backend issues
   */
  static async clearErrorRecords(): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'DELETE FROM local_measurements WHERE synced = -1'
      );
      
      console.log(`✓ Cleared ${result.changes} error records`);
      return result.changes || 0;
    } catch (error) {
      console.error('Failed to clear error records:', error);
      throw error;
    }
  }

  /**
   * Retry error records by resetting them to unsynced state
   * Use this after fixing backend validation issues
   */
  static async retryErrorRecords(): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'UPDATE local_measurements SET synced = 0, error_message = NULL, error_at = NULL WHERE synced = -1'
      );
      
      console.log(`✓ Reset ${result.changes} error records to retry`);
      return result.changes || 0;
    } catch (error) {
      console.error('Failed to retry error records:', error);
      throw error;
    }
  }

  /**
   * Retry error records for a specific session by resetting them to unsynced state
   * Use this for manual retry of failed sessions from SyncErrorsScreen
   */
  static async retryErrorRecordsBySession(sessionId: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'UPDATE local_measurements SET synced = 0, error_message = NULL, error_at = NULL WHERE synced = -1 AND session_id = ?',
        [sessionId]
      );
      
      console.log(`✓ Reset ${result.changes} error records for session ${sessionId} to retry`);
      return result.changes || 0;
    } catch (error) {
      console.error('Failed to retry error records for session:', error);
      throw error;
    }
  }

  /**
   * Delete unsent (pending) measurements for a specific session
   * Use this for manual deletion of queued measurements from SyncErrorsScreen
   */
  static async deleteUnsentRecordsBySession(sessionId: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'DELETE FROM local_measurements WHERE synced = 0 AND session_id = ?',
        [sessionId]
      );
      
      console.log(`🗑️ Deleted ${result.changes} unsent records for session ${sessionId}`);
      return result.changes || 0;
    } catch (error) {
      console.error('Failed to delete unsent records for session:', error);
      throw error;
    }
  }

  /**
   * Delete error records for a specific session
   * Use this for manual deletion of permanently failed sessions from SyncErrorsScreen
   */
  static async deleteErrorRecordsBySession(sessionId: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.runAsync(
        'DELETE FROM local_measurements WHERE synced = -1 AND session_id = ?',
        [sessionId]
      );
      
      console.log(`🗑️ Deleted ${result.changes} error records for session ${sessionId}`);
      return result.changes || 0;
    } catch (error) {
      console.error('Failed to delete error records for session:', error);
      throw error;
    }
  }

  /**
   * Get unsent (pending) measurements grouped by session_id
   * Returns session_id, count of pending measurements, and oldest measurement timestamp
   */
  static async getUnsentSessionGroups(): Promise<Array<{
    session_id: string;
    count: number;
    oldest_measurement_at: string | null;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<{
        session_id: string;
        count: number;
        oldest_measurement_at: string | null;
      }>(
        `SELECT 
          session_id,
          COUNT(*) as count,
          MIN(measured_at) as oldest_measurement_at
         FROM local_measurements 
         WHERE synced = 0 
         GROUP BY session_id
         ORDER BY oldest_measurement_at ASC`
      );
      
      return result;
    } catch (error) {
      console.error('Failed to fetch unsent session groups:', error);
      throw error;
    }
  }

  /**
   * Get error records grouped by session_id for Management by Exception screen
   * Returns session_id, count of failed measurements, error message, and first error timestamp
   */
  static async getErrorSessionGroups(): Promise<Array<{
    session_id: string;
    count: number;
    error_message: string | null;
    first_error_at: string | null;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const result = await this.db.getAllAsync<{
        session_id: string;
        count: number;
        error_message: string | null;
        first_error_at: string | null;
      }>(
        `SELECT 
          session_id,
          COUNT(*) as count,
          MAX(error_message) as error_message,
          MIN(error_at) as first_error_at
         FROM local_measurements 
         WHERE synced = -1 
         GROUP BY session_id
         ORDER BY first_error_at DESC`
      );
      
      return result;
    } catch (error) {
      console.error('Failed to fetch error session groups:', error);
      throw error;
    }
  }

  /**
   * Clear all measurements (for testing/debugging)
   */
  static async clearAll(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      await this.db.runAsync('DELETE FROM local_measurements');
      console.log('✓ Database cleared');
    } catch (error) {
      console.error('Failed to clear database:', error);
      throw error;
    }
  }
}
