/**
 * Global Jest setup — runs after the test environment is installed
 * (setupFilesAfterEnv).
 *
 * Keep this file minimal: only truly global concerns belong here.
 * Module-specific mocks live in the individual test files via jest.mock().
 */

// Silence routine log/warn output during test runs; tests that need to assert
// on console output override these spies locally.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ── Alert ─────────────────────────────────────────────────────────────────────
// The jest-expo preset mocks react-native, but Alert.alert may still be
// undefined because it normally delegates to a native TurboModule that is not
// available in the test environment. We replace it with a stable jest.fn() so
// tests can spy on it without calling `jest.requireActual('react-native')`.
// This runs once per worker, but each test file has its own module registry,
// so the reference is fresh for every file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Alert } = require('react-native');
if (Alert) {
  Alert.alert = jest.fn();
}

// Reset the Alert.alert spy between tests so call counts don't bleed across.
beforeEach(() => {
  if (Alert && jest.isMockFunction(Alert.alert)) {
    (Alert.alert as jest.Mock).mockClear();
  }
});

// ── expo-keep-awake ────────────────────────────────────────────────────────────
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

// ── expo-status-bar ───────────────────────────────────────────────────────────
jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));
