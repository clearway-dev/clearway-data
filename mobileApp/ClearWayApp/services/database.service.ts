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
          synced INTEGER DEFAULT 0
        );
        
        CREATE INDEX IF NOT EXISTS idx_synced ON local_measurements(synced);
        CREATE INDEX IF NOT EXISTS idx_session ON local_measurements(session_id);
      `);
      
      console.log('✓ Database initialized');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Insert measurement into local database
   */
  static async insertMeasurement(measurement: Omit<LocalMeasurement, 'id' | 'synced'>): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      await this.db.runAsync(
        `INSERT INTO local_measurements 
         (session_id, measured_at, latitude, longitude, distance_left, distance_right, synced) 
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
          measurement.session_id,
          measurement.measured_at,
          measurement.latitude,
          measurement.longitude,
          measurement.distance_left,
          measurement.distance_right,
        ]
      );
    } catch (error) {
      console.error('Failed to insert measurement:', error);
      throw error;
    }
  }

  /**
   * Get unsynced measurements (max 100)
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
  static async getStats(): Promise<{ total: number; unsynced: number }> {
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
      
      return {
        total: totalResult?.count || 0,
        unsynced: unsyncedResult?.count || 0,
      };
    } catch (error) {
      console.error('Failed to get database stats:', error);
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
