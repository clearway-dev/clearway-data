import { useState, useEffect } from 'react';
import { SyncService } from '../services/sync.service';
import { DatabaseService } from '../services/database.service';

export const useSync = (enabled: boolean) => {
  const [stats, setStats] = useState({ total: 0, unsynced: 0 });

  useEffect(() => {
    if (enabled) {
      SyncService.startSync(10000); // 10 seconds
    } else {
      SyncService.stopSync();
    }

    return () => {
      SyncService.stopSync();
    };
  }, [enabled]);

  useEffect(() => {
    // Update stats every 5 seconds
    const interval = setInterval(async () => {
      try {
        const dbStats = await DatabaseService.getStats();
        setStats(dbStats);
      } catch (error) {
        console.error('Failed to get stats:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const forceSync = async () => {
    await SyncService.forceSync();
    const dbStats = await DatabaseService.getStats();
    setStats(dbStats);
  };

  return { stats, forceSync };
};
