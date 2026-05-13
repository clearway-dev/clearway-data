/**
 * useSync — manages background sync lifecycle and exposes DB stats to the UI.
 *
 * Tests verify:
 * - SyncService.startSync() is called when enabled=true
 * - SyncService.stopSync() is called on cleanup and when enabled=false
 * - forceSync() calls SyncService.forceSync() and refreshes stats
 * - Stats are refreshed on a 5s interval while the hook is mounted
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useSync } from '../../hooks/useSync';
import { SyncService } from '../../services/sync.service';
import { DatabaseService } from '../../services/database.service';

jest.mock('../../services/sync.service');
jest.mock('../../services/database.service');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (SyncService.startSync as jest.Mock).mockImplementation(() => {});
  (SyncService.stopSync as jest.Mock).mockImplementation(() => {});
  (SyncService.forceSync as jest.Mock).mockResolvedValue(undefined);
  (DatabaseService.getStats as jest.Mock).mockResolvedValue({ total: 0, unsynced: 0, errors: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSync — sync lifecycle', () => {
  it('starts sync when enabled=true', () => {
    renderHook(() => useSync(true));

    expect(SyncService.startSync).toHaveBeenCalledWith(30000);
  });

  it('does NOT start sync when enabled=false', () => {
    renderHook(() => useSync(false));

    expect(SyncService.startSync).not.toHaveBeenCalled();
  });

  it('stops sync on unmount', () => {
    const { unmount } = renderHook(() => useSync(true));

    unmount();

    expect(SyncService.stopSync).toHaveBeenCalled();
  });

  it('stops sync when enabled switches from true to false', () => {
    const { rerender } = renderHook(({ enabled }) => useSync(enabled), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: false });

    expect(SyncService.stopSync).toHaveBeenCalled();
  });
});

describe('useSync — stats refresh', () => {
  it('fetches stats on the 5s interval', async () => {
    (DatabaseService.getStats as jest.Mock)
      .mockResolvedValueOnce({ total: 5, unsynced: 3, errors: 0 });

    const { result } = renderHook(() => useSync(true));

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.stats.unsynced).toBe(3);
    });
  });
});

describe('useSync — forceSync', () => {
  it('calls SyncService.forceSync and updates stats', async () => {
    (DatabaseService.getStats as jest.Mock).mockResolvedValue({ total: 2, unsynced: 1, errors: 0 });

    const { result } = renderHook(() => useSync(true));

    await act(async () => {
      await result.current.forceSync();
    });

    expect(SyncService.forceSync).toHaveBeenCalledTimes(1);
    expect(result.current.stats.unsynced).toBe(1);
  });
});
