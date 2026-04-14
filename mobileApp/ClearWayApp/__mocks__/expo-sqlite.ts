/**
 * Manual mock for expo-sqlite.
 *
 * Used by moduleNameMapper in jest.config.js so that any file importing
 * expo-sqlite (directly or transitively) gets this stub instead of the
 * native module, which cannot run in a Node/Jest environment.
 *
 * DatabaseService tests override individual methods per-test via
 *   (DatabaseService as any).db = mockDb
 * so this factory only needs to exist — it is never called directly by tests.
 */

const createMockDb = () => ({
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 1 }),
  getAllAsync: jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  closeAsync: jest.fn().mockResolvedValue(undefined),
});

export const openDatabaseAsync = jest
  .fn()
  .mockImplementation(() => Promise.resolve(createMockDb()));

// Named re-exports that some expo-sqlite consumers may use
export const SQLiteDatabase = jest.fn();
export const useSQLiteContext = jest.fn();

export default { openDatabaseAsync, SQLiteDatabase, useSQLiteContext };
