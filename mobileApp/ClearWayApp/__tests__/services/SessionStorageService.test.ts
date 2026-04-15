/**
 * SessionStorageService — AsyncStorage wrapper for persisting session state
 * across app restarts (zombie sync recovery).
 *
 * The module uses the official in-memory mock from
 * @react-native-async-storage/async-storage/jest/async-storage-mock
 * configured via moduleNameMapper in jest.config.js — no extra jest.mock() needed.
 */

import { SessionStorageService } from '../../services/session-storage.service';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@clearway/last_session';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SessionStorageService.saveSession()', () => {
  it('persists sessionId, vehicleId, sensorId, and a timestamp', async () => {
    const before = Date.now();
    await SessionStorageService.saveSession('sess-1', 'veh-1', 'sen-1');
    const after = Date.now();

    const raw = await AsyncStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.vehicleId).toBe('veh-1');
    expect(parsed.sensorId).toBe('sen-1');
    expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
    expect(parsed.timestamp).toBeLessThanOrEqual(after);
  });

  it('overwrites a previously saved session', async () => {
    await SessionStorageService.saveSession('old-sess', 'v1', 's1');
    await SessionStorageService.saveSession('new-sess', 'v2', 's2');

    const raw = await AsyncStorage.getItem(SESSION_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.sessionId).toBe('new-sess');
  });
});

describe('SessionStorageService.loadSession()', () => {
  it('returns null when nothing has been stored', async () => {
    const result = await SessionStorageService.loadSession();
    expect(result).toBeNull();
  });

  it('returns the stored session state', async () => {
    await SessionStorageService.saveSession('sess-abc', 'veh-abc', 'sen-abc');

    const result = await SessionStorageService.loadSession();

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-abc');
    expect(result!.vehicleId).toBe('veh-abc');
    expect(result!.sensorId).toBe('sen-abc');
    expect(typeof result!.timestamp).toBe('number');
  });

  it('returns null when stored value is corrupt JSON', async () => {
    await AsyncStorage.setItem(SESSION_KEY, '{not valid json');

    const result = await SessionStorageService.loadSession();
    expect(result).toBeNull();
  });
});

describe('SessionStorageService.clearSession()', () => {
  it('removes the stored session so loadSession returns null afterwards', async () => {
    await SessionStorageService.saveSession('s', 'v', 'sn');
    await SessionStorageService.clearSession();

    const result = await SessionStorageService.loadSession();
    expect(result).toBeNull();
  });
});
