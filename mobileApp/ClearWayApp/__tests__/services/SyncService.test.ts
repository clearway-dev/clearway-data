/**
 * SyncService — background sync worker (syncOnce, startSync, stopSync, subscribe).
 *
 * This is the most critical service test file because SyncService coordinates
 * DatabaseService and ApiService and implements the poison-pill and retry logic.
 * Regressions here can silently lose or permanently block measurement data.
 *
 * All timers are faked so startSync/stopSync tests are deterministic.
 *
 * NOTE: api.service is PARTIALLY mocked — ApiError is kept real so that the
 * `instanceof ApiError` check inside SyncService works correctly.
 */

import { SyncService } from '../../services/sync.service';
import { DatabaseService } from '../../services/database.service';
import { SyncStatus } from '../../types';

// ── Partial mock: keep ApiError real, only mock ApiService.sendBatch ──────────

jest.mock('../../services/api.service', () => {
  const actual =
    jest.requireActual<typeof import('../../services/api.service')>(
      '../../services/api.service'
    );
  return {
    ApiError: actual.ApiError,
    ApiService: {
      sendBatch: jest.fn(),
    },
  };
});

jest.mock('../../services/database.service');

import { ApiService, ApiError } from '../../services/api.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const resetSyncService = () => {
  (SyncService as unknown as { isSyncing: boolean }).isSyncing = false;
  (SyncService as unknown as { intervalId: null }).intervalId = null;
  (SyncService as unknown as { listeners: [] }).listeners = [];
};

const makeMeasurement = (id: number, sessionId = 'sess-1') => ({
  id,
  session_id: sessionId,
  measured_at: '2024-01-01T00:00:00.000Z',
  latitude: 50.0,
  longitude: 14.0,
  distance_left: 300,
  distance_right: 300,
  speed: null,
  accuracy_gps: null,
  synced: 0,
  error_message: null,
  error_at: null,
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetSyncService();
});

afterEach(() => {
  jest.useRealTimers();
  SyncService.stopSync();
});

// ── syncOnce: no data ─────────────────────────────────────────────────────────

describe('SyncService.syncOnce() — no pending data', () => {
  it('emits "idle" status and does not call ApiService', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce([]);

    const statusHistory: SyncStatus[] = [];
    SyncService.subscribe((s) => statusHistory.push(s));

    await SyncService.syncOnce();

    expect(ApiService.sendBatch).not.toHaveBeenCalled();
    expect(statusHistory).toContainEqual({ status: 'idle' });
  });
});

// ── syncOnce: success path ────────────────────────────────────────────────────

describe('SyncService.syncOnce() — successful sync', () => {
  it('sends batch and deletes measurements on 2xx', async () => {
    const measurements = [makeMeasurement(1), makeMeasurement(2)];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-1']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock).mockResolvedValueOnce(measurements);
    (ApiService.sendBatch as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.deleteMeasurements as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 0, unsynced: 0, errors: 0 });

    await SyncService.syncOnce();

    expect(ApiService.sendBatch).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-1' })
    );
    expect(DatabaseService.deleteMeasurements).toHaveBeenCalledWith([1, 2]);
  });

  it('emits "success" status after sync', async () => {
    const measurements = [makeMeasurement(1)];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-1']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock).mockResolvedValueOnce(measurements);
    (ApiService.sendBatch as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.deleteMeasurements as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 0, unsynced: 0, errors: 0 });

    const statuses: string[] = [];
    SyncService.subscribe((s) => statuses.push(s.status));

    await SyncService.syncOnce();

    expect(statuses).toContain('success');
  });

  it('processes sessions FIFO — passes all session ids to sendBatch in order', async () => {
    const m1 = [makeMeasurement(1, 'sess-old')];
    const m2 = [makeMeasurement(2, 'sess-new')];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-old', 'sess-new']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock)
      .mockResolvedValueOnce(m1)
      .mockResolvedValueOnce(m2);
    (ApiService.sendBatch as jest.Mock).mockResolvedValue(undefined);
    (DatabaseService.deleteMeasurements as jest.Mock).mockResolvedValue(undefined);
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 0, unsynced: 0, errors: 0 });

    await SyncService.syncOnce();

    const calls = (ApiService.sendBatch as jest.Mock).mock.calls;
    expect(calls[0][0].session_id).toBe('sess-old');
    expect(calls[1][0].session_id).toBe('sess-new');
  });
});

// ── syncOnce: poison pill (4xx) ───────────────────────────────────────────────

describe('SyncService.syncOnce() — poison pill (4xx)', () => {
  it('calls markAsError and does NOT delete measurements', async () => {
    const measurements = [makeMeasurement(1), makeMeasurement(2)];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-1']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock)
      .mockResolvedValue(measurements); // called twice (try + catch)
    (ApiService.sendBatch as jest.Mock).mockRejectedValueOnce(
      new ApiError(422, 'Unprocessable Entity', 'Invalid coordinates')
    );
    (DatabaseService.markAsError as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 2, unsynced: 0, errors: 2 });

    await SyncService.syncOnce();

    expect(DatabaseService.markAsError).toHaveBeenCalledWith(
      [1, 2],
      expect.stringContaining('422')
    );
    expect(DatabaseService.deleteMeasurements).not.toHaveBeenCalled();
  });

  it('emits "error" status on poison pill', async () => {
    const measurements = [makeMeasurement(1)];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-1']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock).mockResolvedValue(measurements);
    (ApiService.sendBatch as jest.Mock).mockRejectedValueOnce(
      new ApiError(400, 'Bad Request')
    );
    (DatabaseService.markAsError as jest.Mock).mockResolvedValueOnce(undefined);
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 1, unsynced: 0, errors: 1 });

    const statuses: string[] = [];
    SyncService.subscribe((s) => statuses.push(s.status));

    await SyncService.syncOnce();

    expect(statuses).toContain('error');
  });
});

// ── syncOnce: server error (5xx) — retry ─────────────────────────────────────

describe('SyncService.syncOnce() — server error (5xx)', () => {
  it('does NOT mark as error — keeps synced=0 so next cycle retries', async () => {
    const measurements = [makeMeasurement(1)];

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce(['sess-1']);
    (DatabaseService.getUnsyncedMeasurementsBySession as jest.Mock).mockResolvedValueOnce(measurements);
    (ApiService.sendBatch as jest.Mock).mockRejectedValueOnce(
      new ApiError(503, 'Service Unavailable')
    );
    (DatabaseService.getStats as jest.Mock).mockResolvedValueOnce({ total: 1, unsynced: 1, errors: 0 });

    await SyncService.syncOnce();

    expect(DatabaseService.markAsError).not.toHaveBeenCalled();
    expect(DatabaseService.deleteMeasurements).not.toHaveBeenCalled();
  });
});

// ── syncOnce: concurrency lock ────────────────────────────────────────────────

describe('SyncService.syncOnce() — concurrency guard', () => {
  it('skips second call while first is still in progress', async () => {
    let resolveSync!: () => void;
    const blockingPromise = new Promise<[]>((resolve) => {
      resolveSync = () => resolve([]);
    });

    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockReturnValueOnce(blockingPromise);

    // Start first call (doesn't resolve yet)
    const first = SyncService.syncOnce();

    // Immediately start second call — should be ignored
    await SyncService.syncOnce();

    // Only one getUnsyncedSessionIds call happened
    expect(DatabaseService.getUnsyncedSessionIds).toHaveBeenCalledTimes(1);

    // Resolve the first call
    resolveSync();
    await first;
  });
});

// ── startSync / stopSync ──────────────────────────────────────────────────────

describe('SyncService.startSync() / stopSync()', () => {
  it('calls syncOnce immediately on start', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValue([]);

    SyncService.startSync(10000);
    await Promise.resolve(); // flush immediate syncOnce

    expect(DatabaseService.getUnsyncedSessionIds).toHaveBeenCalledTimes(1);
    SyncService.stopSync();
  });

  it('calls syncOnce again after the interval fires', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValue([]);

    SyncService.startSync(10000);
    await Promise.resolve(); // flush immediate call

    jest.advanceTimersByTime(10000);
    await Promise.resolve(); // flush interval call

    expect(DatabaseService.getUnsyncedSessionIds).toHaveBeenCalledTimes(2);
    SyncService.stopSync();
  });

  it('warns and does nothing when startSync is called while already running', () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValue([]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    SyncService.startSync(10000);
    SyncService.startSync(10000);

    expect(warnSpy).toHaveBeenCalledWith('Sync already running');
    SyncService.stopSync();
  });

  it('stopSync clears the interval so no further calls happen', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValue([]);

    SyncService.startSync(10000);
    await Promise.resolve();

    SyncService.stopSync();

    jest.advanceTimersByTime(30000);
    await Promise.resolve();

    // Only the initial immediate call
    expect(DatabaseService.getUnsyncedSessionIds).toHaveBeenCalledTimes(1);
  });
});

// ── subscribe / unsubscribe ───────────────────────────────────────────────────

describe('SyncService.subscribe()', () => {
  it('notifies listener on status change', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValueOnce([]);

    const received: SyncStatus[] = [];
    SyncService.subscribe((s) => received.push(s));

    await SyncService.syncOnce();

    expect(received.length).toBeGreaterThan(0);
  });

  it('unsubscribe function removes the listener', async () => {
    (DatabaseService.getUnsyncedSessionIds as jest.Mock).mockResolvedValue([]);

    const received: SyncStatus[] = [];
    const unsub = SyncService.subscribe((s) => received.push(s));
    unsub();

    await SyncService.syncOnce();

    expect(received).toHaveLength(0);
  });
});
