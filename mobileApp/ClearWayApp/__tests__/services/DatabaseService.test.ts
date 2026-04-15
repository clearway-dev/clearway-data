/**
 * DatabaseService — SQLite wrapper for local_measurements.
 *
 * Tests verify:
 * - "Database not initialized" guard on every public method
 * - Correct SQL parameters (IN clause size, field ordering)
 * - markAsError sets synced=-1 with error_message + error_at
 * - deleteMeasurements with empty list is a no-op (avoids "DELETE FROM ... IN ()" SQL error)
 * - getStats returns correctly shaped object
 * - Session-scoped operations (retry, delete) use correct WHERE clause
 */

import { DatabaseService } from '../../services/database.service';

// ── SQLite mock ───────────────────────────────────────────────────────────────

const ALL_COLUMNS = [
  { name: 'id' }, { name: 'session_id' }, { name: 'measured_at' },
  { name: 'latitude' }, { name: 'longitude' }, { name: 'distance_left' },
  { name: 'distance_right' }, { name: 'speed' }, { name: 'accuracy_gps' },
  { name: 'synced' }, { name: 'error_message' }, { name: 'error_at' },
];

const makeMockDb = () => ({
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockResolvedValue({ changes: 1 }),
  getAllAsync: jest.fn().mockImplementation((sql: string) => {
    // PRAGMA returns all columns → no migration runs
    if (sql.includes('PRAGMA')) return Promise.resolve(ALL_COLUMNS);
    return Promise.resolve([]);
  }),
  getFirstAsync: jest.fn().mockResolvedValue(null),
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

import * as SQLite from 'expo-sqlite';

// ── Helpers ───────────────────────────────────────────────────────────────────

const resetDb = () => {
  (DatabaseService as unknown as { db: null }).db = null;
};

const makeMeasurement = (overrides = {}) => ({
  session_id: 'sess-1',
  measured_at: '2024-01-01T00:00:00.000Z',
  latitude: 50.0,
  longitude: 14.0,
  distance_left: 300,
  distance_right: 300,
  speed: 10,
  accuracy_gps: 5,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetDb();
});

// ── initialize ────────────────────────────────────────────────────────────────

describe('DatabaseService.initialize()', () => {
  it('opens the database and creates the table', async () => {
    const mockDb = makeMockDb();
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('clearway.db');
    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS local_measurements')
    );
  });

  it('runs migration when "speed" column is missing', async () => {
    const colsWithoutSpeed = ALL_COLUMNS.filter((c) => c.name !== 'speed');
    const mockDb = {
      ...makeMockDb(),
      getAllAsync: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('PRAGMA')) return Promise.resolve(colsWithoutSpeed);
        return Promise.resolve([]);
      }),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN speed REAL')
    );
  });

  it('runs migration when "accuracy_gps" column is missing', async () => {
    const cols = ALL_COLUMNS.filter((c) => c.name !== 'accuracy_gps');
    const mockDb = {
      ...makeMockDb(),
      getAllAsync: jest.fn().mockImplementation((sql: string) =>
        sql.includes('PRAGMA') ? Promise.resolve(cols) : Promise.resolve([])
      ),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN accuracy_gps REAL')
    );
  });

  it('runs migration when "error_message" column is missing', async () => {
    const cols = ALL_COLUMNS.filter((c) => c.name !== 'error_message');
    const mockDb = {
      ...makeMockDb(),
      getAllAsync: jest.fn().mockImplementation((sql: string) =>
        sql.includes('PRAGMA') ? Promise.resolve(cols) : Promise.resolve([])
      ),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN error_message TEXT')
    );
  });

  it('runs migration when "error_at" column is missing', async () => {
    const cols = ALL_COLUMNS.filter((c) => c.name !== 'error_at');
    const mockDb = {
      ...makeMockDb(),
      getAllAsync: jest.fn().mockImplementation((sql: string) =>
        sql.includes('PRAGMA') ? Promise.resolve(cols) : Promise.resolve([])
      ),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN error_at TEXT')
    );
  });

  it('skips all ALTER statements when all columns are present', async () => {
    const mockDb = makeMockDb(); // getAllAsync returns ALL_COLUMNS by default
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(mockDb);

    await DatabaseService.initialize();

    // execAsync is called once (CREATE TABLE) — never for any ALTER
    const alterCalls = (mockDb.execAsync as jest.Mock).mock.calls.filter(
      ([sql]: [string]) => sql.includes('ALTER')
    );
    expect(alterCalls).toHaveLength(0);
  });

  it('throws when openDatabaseAsync rejects', async () => {
    (SQLite.openDatabaseAsync as jest.Mock).mockRejectedValueOnce(
      new Error('disk error')
    );

    await expect(DatabaseService.initialize()).rejects.toThrow('disk error');
  });
});

// ── "not initialized" guard ───────────────────────────────────────────────────

describe('Guard: throws when db is null', () => {
  const methods: Array<() => Promise<unknown>> = [
    () => DatabaseService.insertMeasurement(makeMeasurement()),
    () => DatabaseService.getUnsyncedSessionIds(),
    () => DatabaseService.getUnsyncedMeasurementsBySession('s1'),
    () => DatabaseService.getUnsyncedMeasurements(),
    () => DatabaseService.markAsSynced([1]),
    () => DatabaseService.markAsError([1], 'err'),
    () => DatabaseService.deleteMeasurements([1]),
    () => DatabaseService.deleteSynced(),
    () => DatabaseService.getStats(),
    () => DatabaseService.getErrorRecords(),
    () => DatabaseService.clearErrorRecords(),
    () => DatabaseService.retryErrorRecords(),
    () => DatabaseService.retryErrorRecordsBySession('s1'),
    () => DatabaseService.deleteUnsentRecordsBySession('s1'),
    () => DatabaseService.deleteErrorRecordsBySession('s1'),
    () => DatabaseService.getUnsentSessionGroups(),
    () => DatabaseService.getErrorSessionGroups(),
    () => DatabaseService.clearAll(),
  ];

  it.each(methods)('method %# throws "Database not initialized"', async (method) => {
    await expect(method()).rejects.toThrow('Database not initialized');
  });
});

// ── insertMeasurement ─────────────────────────────────────────────────────────

describe('DatabaseService.insertMeasurement()', () => {
  it('calls runAsync with the correct column order and synced=0', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.insertMeasurement(makeMeasurement());

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO local_measurements'),
      expect.arrayContaining(['sess-1', 50.0, 14.0])
    );
    const args = (mockDb.runAsync as jest.Mock).mock.calls[0][1];
    // Last entry in params is synced (should NOT be here — it's embedded as literal 0)
    expect(args[0]).toBe('sess-1'); // session_id
  });

  it('passes null speed and accuracy when GPS does not provide them', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.insertMeasurement(
      makeMeasurement({ speed: null, accuracy_gps: null })
    );

    const args = (mockDb.runAsync as jest.Mock).mock.calls[0][1];
    expect(args).toContain(null); // speed
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('constraint'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.insertMeasurement(makeMeasurement())).rejects.toThrow(
      'constraint'
    );
  });
});

// ── markAsError ───────────────────────────────────────────────────────────────

describe('DatabaseService.markAsError()', () => {
  it('is a no-op when ids array is empty', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsError([], 'some error');

    expect(mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('sets synced=-1, error_message, and error_at for given ids', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsError([1, 2, 3], 'HTTP 422: bad field');

    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = -1');
    expect(sql).toContain('error_message = ?');
    expect(sql).toContain('error_at = ?');
    expect(params[0]).toBe('HTTP 422: bad field');   // error_message
    expect(params[1]).toMatch(/^\d{4}-\d{2}-\d{2}/); // error_at ISO string
    expect(params).toContain(1);
    expect(params).toContain(2);
    expect(params).toContain(3);
  });

  it('builds correct number of placeholders for IN clause', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsError([10, 20], 'err');

    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('IN (?,?)');
  });
});

// ── deleteMeasurements ────────────────────────────────────────────────────────

describe('DatabaseService.deleteMeasurements()', () => {
  it('is a no-op when ids array is empty', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.deleteMeasurements([]);

    expect(mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('deletes by id IN clause', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.deleteMeasurements([5, 6]);

    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('DELETE FROM local_measurements');
    expect(sql).toContain('IN (?,?)');
    expect(params).toEqual([5, 6]);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('DatabaseService.getStats()', () => {
  it('returns total, unsynced, and errors counts', async () => {
    const mockDb = makeMockDb();
    mockDb.getFirstAsync
      .mockResolvedValueOnce({ count: 10 }) // total
      .mockResolvedValueOnce({ count: 3 })  // unsynced
      .mockResolvedValueOnce({ count: 1 }); // errors
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const stats = await DatabaseService.getStats();

    expect(stats).toEqual({ total: 10, unsynced: 3, errors: 1 });
  });

  it('returns zeros when table is empty', async () => {
    const mockDb = makeMockDb();
    mockDb.getFirstAsync
      .mockResolvedValue({ count: 0 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const stats = await DatabaseService.getStats();

    expect(stats).toEqual({ total: 0, unsynced: 0, errors: 0 });
  });
});

// ── retryErrorRecordsBySession ────────────────────────────────────────────────

describe('DatabaseService.retryErrorRecordsBySession()', () => {
  it('resets synced to 0 and clears error fields for the given session', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 5 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.retryErrorRecordsBySession('sess-abc');

    expect(count).toBe(5);
    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = 0');
    expect(sql).toContain('error_message = NULL');
    expect(sql).toContain('synced = -1 AND session_id = ?');
    expect(params).toEqual(['sess-abc']);
  });
});

// ── deleteErrorRecordsBySession ───────────────────────────────────────────────

describe('DatabaseService.deleteErrorRecordsBySession()', () => {
  it('deletes only error records (synced=-1) for the given session', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 3 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.deleteErrorRecordsBySession('sess-xyz');

    expect(count).toBe(3);
    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('DELETE FROM local_measurements');
    expect(sql).toContain('synced = -1');
    expect(sql).toContain('session_id = ?');
    expect(params).toEqual(['sess-xyz']);
  });
});

// ── getUnsyncedSessionIds ─────────────────────────────────────────────────────

describe('DatabaseService.getUnsyncedSessionIds()', () => {
  it('returns ordered session_id strings', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([
      { session_id: 'sess-old', oldest_measurement: '2024-01-01T00:00:00Z' },
      { session_id: 'sess-new', oldest_measurement: '2024-01-02T00:00:00Z' },
    ]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const ids = await DatabaseService.getUnsyncedSessionIds();

    expect(ids).toEqual(['sess-old', 'sess-new']);
  });

  it('returns empty array when no pending sessions exist', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const ids = await DatabaseService.getUnsyncedSessionIds();

    expect(ids).toEqual([]);
  });
});

// ── deleteMeasurements — catch branch ─────────────────────────────────────────

describe('DatabaseService.deleteMeasurements() — error propagation', () => {
  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('disk full'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.deleteMeasurements([1])).rejects.toThrow('disk full');
  });
});

// ── getStats — catch + null-fallback branches ─────────────────────────────────

describe('DatabaseService.getStats() — additional branches', () => {
  it('returns 0 for each count when getFirstAsync returns null', async () => {
    const mockDb = makeMockDb();
    mockDb.getFirstAsync.mockResolvedValue(null);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const stats = await DatabaseService.getStats();
    expect(stats).toEqual({ total: 0, unsynced: 0, errors: 0 });
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getFirstAsync.mockRejectedValueOnce(new Error('read error'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getStats()).rejects.toThrow('read error');
  });
});

// ── retryErrorRecordsBySession — additional branches ──────────────────────────

describe('DatabaseService.retryErrorRecordsBySession() — additional branches', () => {
  it('returns 0 when changes is null/undefined', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: null });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.retryErrorRecordsBySession('sess-1');
    expect(count).toBe(0);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('write error'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.retryErrorRecordsBySession('sess-1')).rejects.toThrow('write error');
  });
});

// ── deleteErrorRecordsBySession — additional branches ─────────────────────────

describe('DatabaseService.deleteErrorRecordsBySession() — additional branches', () => {
  it('returns 0 when changes is null/undefined', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: null });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.deleteErrorRecordsBySession('sess-1');
    expect(count).toBe(0);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('lock'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.deleteErrorRecordsBySession('sess-1')).rejects.toThrow('lock');
  });
});

// ── getErrorSessionGroups — catch branch ──────────────────────────────────────

describe('DatabaseService.getErrorSessionGroups() — error propagation', () => {
  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockRejectedValueOnce(new Error('query failed'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getErrorSessionGroups()).rejects.toThrow('query failed');
  });
});

// ── getUnsyncedMeasurementsBySession ──────────────────────────────────────────

describe('DatabaseService.getUnsyncedMeasurementsBySession()', () => {
  it('returns measurements for the given session', async () => {
    const mockDb = makeMockDb();
    const rows = [
      { id: 1, session_id: 'sess-A', measured_at: '2024-01-01T00:00:00Z', latitude: 50, longitude: 14, distance_left: 300, distance_right: 300, speed: 10, accuracy_gps: 5, synced: 0, error_message: null, error_at: null },
    ];
    mockDb.getAllAsync.mockResolvedValueOnce(rows);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const result = await DatabaseService.getUnsyncedMeasurementsBySession('sess-A');
    expect(result).toEqual(rows);
  });

  it('passes session_id and default limit 1500 to the query', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getUnsyncedMeasurementsBySession('sess-B');

    const [sql, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = 0 AND session_id = ?');
    expect(sql).toContain('ORDER BY measured_at ASC');
    expect(params).toEqual(['sess-B', 1500]);
  });

  it('respects a custom limit', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getUnsyncedMeasurementsBySession('sess-C', 50);

    const [, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(params).toEqual(['sess-C', 50]);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockRejectedValueOnce(new Error('io error'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getUnsyncedMeasurementsBySession('sess-X')).rejects.toThrow('io error');
  });
});

// ── getUnsyncedMeasurements ───────────────────────────────────────────────────

describe('DatabaseService.getUnsyncedMeasurements()', () => {
  it('returns all unsynced measurements', async () => {
    const mockDb = makeMockDb();
    const rows = [{ id: 2, session_id: 'sess-1', synced: 0 }];
    mockDb.getAllAsync.mockResolvedValueOnce(rows);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const result = await DatabaseService.getUnsyncedMeasurements();
    expect(result).toEqual(rows);
  });

  it('uses default limit of 100', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getUnsyncedMeasurements();

    const [sql, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = 0');
    expect(params).toEqual([100]);
  });

  it('respects a custom limit', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getUnsyncedMeasurements(25);

    const [, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(params).toEqual([25]);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockRejectedValueOnce(new Error('disk error'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getUnsyncedMeasurements()).rejects.toThrow('disk error');
  });
});

// ── markAsSynced ──────────────────────────────────────────────────────────────

describe('DatabaseService.markAsSynced()', () => {
  it('is a no-op when ids array is empty', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsSynced([]);
    expect(mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('sets synced=1 for all given ids', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsSynced([3, 4, 5]);

    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('SET synced = 1');
    expect(params).toEqual([3, 4, 5]);
  });

  it('builds exact placeholder count for IN clause', async () => {
    const mockDb = makeMockDb();
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.markAsSynced([10, 20, 30]);

    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('IN (?,?,?)');
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('constraint violation'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.markAsSynced([1])).rejects.toThrow('constraint violation');
  });
});

// ── deleteSynced ──────────────────────────────────────────────────────────────

describe('DatabaseService.deleteSynced()', () => {
  it('executes DELETE WHERE synced=1', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 7 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.deleteSynced();

    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toBe('DELETE FROM local_measurements WHERE synced = 1');
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('locked'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.deleteSynced()).rejects.toThrow('locked');
  });
});

// ── getErrorRecords ───────────────────────────────────────────────────────────

describe('DatabaseService.getErrorRecords()', () => {
  it('returns error records ordered by error_at DESC', async () => {
    const mockDb = makeMockDb();
    const rows = [{ id: 10, synced: -1, error_message: 'HTTP 422' }];
    mockDb.getAllAsync.mockResolvedValueOnce(rows);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const result = await DatabaseService.getErrorRecords();
    expect(result).toEqual(rows);
  });

  it('uses default limit of 100', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getErrorRecords();

    const [sql, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = -1');
    expect(sql).toContain('ORDER BY error_at DESC');
    expect(params).toEqual([100]);
  });

  it('respects a custom limit', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getErrorRecords(10);

    const [, params] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(params).toEqual([10]);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockRejectedValueOnce(new Error('read fail'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getErrorRecords()).rejects.toThrow('read fail');
  });
});

// ── clearErrorRecords ─────────────────────────────────────────────────────────

describe('DatabaseService.clearErrorRecords()', () => {
  it('deletes synced=-1 records and returns the number of deleted rows', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 4 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.clearErrorRecords();

    expect(count).toBe(4);
    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('DELETE FROM local_measurements WHERE synced = -1');
  });

  it('returns 0 when changes is null', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: null });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.clearErrorRecords();
    expect(count).toBe(0);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('delete failed'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.clearErrorRecords()).rejects.toThrow('delete failed');
  });
});

// ── retryErrorRecords ─────────────────────────────────────────────────────────

describe('DatabaseService.retryErrorRecords()', () => {
  it('resets all synced=-1 records and returns count', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 6 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.retryErrorRecords();

    expect(count).toBe(6);
    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('SET synced = 0');
    expect(sql).toContain('error_message = NULL');
    expect(sql).toContain('WHERE synced = -1');
  });

  it('returns 0 when changes is null', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: null });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.retryErrorRecords();
    expect(count).toBe(0);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('update fail'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.retryErrorRecords()).rejects.toThrow('update fail');
  });
});

// ── deleteUnsentRecordsBySession ──────────────────────────────────────────────

describe('DatabaseService.deleteUnsentRecordsBySession()', () => {
  it('deletes only pending (synced=0) records for the given session and returns count', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 8 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.deleteUnsentRecordsBySession('sess-pending');

    expect(count).toBe(8);
    const [sql, params] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('DELETE FROM local_measurements');
    expect(sql).toContain('synced = 0 AND session_id = ?');
    expect(params).toEqual(['sess-pending']);
  });

  it('returns 0 when changes is null', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: null });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const count = await DatabaseService.deleteUnsentRecordsBySession('sess-1');
    expect(count).toBe(0);
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('lock timeout'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.deleteUnsentRecordsBySession('sess-1')).rejects.toThrow('lock timeout');
  });
});

// ── getUnsentSessionGroups ────────────────────────────────────────────────────

describe('DatabaseService.getUnsentSessionGroups()', () => {
  it('returns grouped pending sessions with count and oldest timestamp', async () => {
    const mockDb = makeMockDb();
    const rows = [
      { session_id: 'sess-1', count: 42, oldest_measurement_at: '2024-01-01T10:00:00Z' },
      { session_id: 'sess-2', count: 7,  oldest_measurement_at: '2024-01-02T08:00:00Z' },
    ];
    mockDb.getAllAsync.mockResolvedValueOnce(rows);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    const result = await DatabaseService.getUnsentSessionGroups();

    expect(result).toEqual(rows);
  });

  it('uses GROUP BY session_id and ORDER BY oldest_measurement_at ASC', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockResolvedValueOnce([]);
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.getUnsentSessionGroups();

    const [sql] = (mockDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('synced = 0');
    expect(sql).toContain('GROUP BY session_id');
    expect(sql).toContain('ORDER BY oldest_measurement_at ASC');
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.getAllAsync.mockRejectedValueOnce(new Error('timeout'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.getUnsentSessionGroups()).rejects.toThrow('timeout');
  });
});

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('DatabaseService.clearAll()', () => {
  it('executes DELETE FROM local_measurements', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockResolvedValueOnce({ changes: 100 });
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await DatabaseService.clearAll();

    const [sql] = (mockDb.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toBe('DELETE FROM local_measurements');
  });

  it('propagates db errors', async () => {
    const mockDb = makeMockDb();
    mockDb.runAsync.mockRejectedValueOnce(new Error('no space'));
    (DatabaseService as unknown as { db: typeof mockDb }).db = mockDb;

    await expect(DatabaseService.clearAll()).rejects.toThrow('no space');
  });
});
