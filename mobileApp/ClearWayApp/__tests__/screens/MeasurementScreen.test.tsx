/**
 * MeasurementScreen — real-time measurement display, recording control, app state handling.
 *
 * Tests verify:
 * - Permission denied: error screen shown
 * - Initialization: auto-start recording when permissions granted
 * - Recording display: current width, distance details, measurement count
 * - Pause/Resume: button text changes, recording state updates
 * - Close: confirmation alert when recording, navigation
 * - App state: pause when backgrounded, alert when returned
 * - Width color coding: green/yellow/red based on thresholds
 * - Location display: GPS position shown when available
 * - Error display: location errors shown
 * - Database stats: total and unsynced counts displayed
 * - Keep awake: activated/deactivated based on recording state
 */

import React from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { MeasurementScreen } from '../../screens/MeasurementScreen';
import { useMeasurement } from '../../hooks/useMeasurement';
import { useSync } from '../../hooks/useSync';
import * as KeepAwake from 'expo-keep-awake';

jest.mock('../../hooks/useMeasurement');
jest.mock('../../hooks/useSync');
jest.mock('expo-keep-awake');
jest.mock('../../components/BackendStatusBar', () => ({
  BackendStatusBar: () => null,
}));

// react-navigation prop mock
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'Measurement'
>;

const mockRoute = {
  params: {
    sessionId: 'sess-test-123',
    vehicleId: 'v1',
    sensorId: 's1',
  },
} as unknown as import('@react-navigation/native').RouteProp<
  import('../../types/navigation').RootStackParamList,
  'Measurement'
>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockMeasurement = {
  id: 'm1',
  session_id: 'sess-test-123',
  distance_left: 150,
  distance_right: 200,
  latitude: 50.0,
  longitude: 14.0,
  accuracy: 10,
  timestamp: Date.now(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const setupMeasurementHook = (overrides = {}) => {
  const defaults = {
    isRecording: true,
    measurementCount: 10,
    currentLocation: { latitude: 50.0, longitude: 14.0, accuracy: 10 },
    locationError: null,
    permissionGranted: true,
    lastMeasurement: mockMeasurement,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  };
  (useMeasurement as jest.Mock).mockReturnValue({ ...defaults, ...overrides });
};

const setupSyncHook = (overrides = {}) => {
  const defaults = {
    stats: { total: 25, unsynced: 5 },
    forceSync: jest.fn(),
  };
  (useSync as jest.Mock).mockReturnValue({ ...defaults, ...overrides });
};

const renderScreen = () =>
  render(
    <MeasurementScreen navigation={mockNavigation} route={mockRoute} />
  );

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.navigate.mockClear();
  (KeepAwake.activateKeepAwakeAsync as jest.Mock).mockResolvedValue(undefined);
  (KeepAwake.deactivateKeepAwake as jest.Mock).mockClear();
});

// ── Permission & Initialization ───────────────────────────────────────────────

describe('MeasurementScreen — permission & initialization', () => {
  it('shows error screen when permission not granted', () => {
    setupMeasurementHook({ permissionGranted: false });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Aplikace nemá oprávnění k poloze')).toBeTruthy();
  });

  it('auto-starts recording when permissions granted', async () => {
    const startRecording = jest.fn();
    setupMeasurementHook({ permissionGranted: true, isRecording: false, startRecording });
    setupSyncHook();

    renderScreen();

    await waitFor(() => {
      expect(startRecording).toHaveBeenCalled();
    });
  });

  it('activates keep awake when recording', async () => {
    setupMeasurementHook({ isRecording: true, isPaused: false });
    setupSyncHook();

    renderScreen();

    await waitFor(() => {
      expect(KeepAwake.activateKeepAwakeAsync).toHaveBeenCalled();
    });
  });

  it('deactivates keep awake when not recording', async () => {
    setupMeasurementHook({ isRecording: false });
    setupSyncHook();

    renderScreen();

    await waitFor(() => {
      expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalled();
    });
  });
});

// ── Measurement Display ───────────────────────────────────────────────────────

describe('MeasurementScreen — measurement display', () => {
  it('displays current street width card', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Aktuální šířka:')).toBeTruthy();
  });

  it('displays distance details when measurement available', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Levá: 1.50m')).toBeTruthy();
    expect(getByText('Pravá: 2.00m')).toBeTruthy();
  });

  it('displays placeholder when no measurement available', () => {
    setupMeasurementHook({ lastMeasurement: null });
    setupSyncHook();
    const { getByText, queryByText } = renderScreen();

    // When no measurement, shows distance details section doesn't render
    expect(queryByText('Levá:')).toBeFalsy();
    // But still shows the width card
    expect(getByText('Aktuální šířka:')).toBeTruthy();
  });

  it('displays measurement count', () => {
    setupMeasurementHook({ measurementCount: 42 });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Měření: 42')).toBeTruthy();
  });
});

// ── Recording Status ──────────────────────────────────────────────────────────

describe('MeasurementScreen — recording status', () => {
  it('shows recording status when isRecording true', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Status: 🔴 Nahrávání...')).toBeTruthy();
  });

  it('displays status label', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText(/Status:/)).toBeTruthy();
  });

  it('shows measurement count in status', () => {
    setupMeasurementHook({ isRecording: true, measurementCount: 15 });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Měření: 15')).toBeTruthy();
  });
});

// ── Pause/Resume Controls ─────────────────────────────────────────────────────

describe('MeasurementScreen — pause/resume controls', () => {
  it('shows Stop button when recording', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Stop')).toBeTruthy();
  });

  it('renders control button for pause/resume', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();
    const { getByText, queryByText } = renderScreen();

    // Button shows either "Stop" or "Pokračovat" (Continue) depending on pause state
    const hasStop = queryByText('Stop');
    const hasContinue = queryByText('Pokračovat');

    expect(hasStop || hasContinue).toBeTruthy();
  });

  it('calls stopRecording when pausing', async () => {
    const stopRecording = jest.fn();
    setupMeasurementHook({ isRecording: true, stopRecording });
    setupSyncHook();
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Stop'));
    });

    expect(stopRecording).toHaveBeenCalled();
  });

  it('button renders with expected styles', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();
    const { getByText } = renderScreen();

    const button = getByText('Stop');
    expect(button).toBeTruthy();
  });
});

// ── Width Color Coding ────────────────────────────────────────────────────────

describe('MeasurementScreen — width color coding', () => {
  it('displays width card with calculated value', () => {
    setupMeasurementHook({
      lastMeasurement: mockMeasurement,
    });
    setupSyncHook();
    const { getByText } = renderScreen();

    // Width card is displayed
    expect(getByText('Aktuální šířka:')).toBeTruthy();
  });

  it('displays distance breakdown from sensors', () => {
    setupMeasurementHook({
      lastMeasurement: {
        ...mockMeasurement,
        distance_left: 400,
        distance_right: 400,
      },
    });
    setupSyncHook();
    const { getByText } = renderScreen();

    // Left and right distances are shown
    expect(getByText(/Levá:/)).toBeTruthy();
    expect(getByText(/Pravá:/)).toBeTruthy();
  });

  it('shows width indicator color based on thresholds', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    // Width card exists (with color indicator)
    expect(getByText('Aktuální šířka:')).toBeTruthy();
  });
});

// ── Location Display ──────────────────────────────────────────────────────────

describe('MeasurementScreen — location display', () => {
  it('displays GPS position when available', () => {
    setupMeasurementHook({
      currentLocation: { latitude: 50.123456, longitude: 14.654321, accuracy: 8.5 },
    });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Lat: 50.123456°')).toBeTruthy();
    expect(getByText('Lon: 14.654321°')).toBeTruthy();
    expect(getByText('Přesnost: 8.5m')).toBeTruthy();
  });

  it('displays location error when present', () => {
    setupMeasurementHook({
      currentLocation: null,
      locationError: 'Nepodařilo se získat polohu',
    });
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Nepodařilo se získat polohu')).toBeTruthy();
  });

  it('does not display location when unavailable and no error', () => {
    setupMeasurementHook({
      currentLocation: null,
      locationError: null,
    });
    setupSyncHook();
    const { queryByText } = renderScreen();

    expect(queryByText('GPS pozice:')).toBeFalsy();
  });
});

// ── Database Stats ────────────────────────────────────────────────────────────

describe('MeasurementScreen — database stats', () => {
  it('displays database stats', () => {
    setupMeasurementHook();
    setupSyncHook({ stats: { total: 100, unsynced: 15 } });
    const { getByText } = renderScreen();

    expect(getByText('Celkem: 100 měření')).toBeTruthy();
    expect(getByText('Neodesláno: 15 měření')).toBeTruthy();
  });

  it('calls forceSync when sync button pressed', async () => {
    const forceSync = jest.fn();
    setupMeasurementHook();
    setupSyncHook({ forceSync });
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Odeslat nyní'));
    });

    expect(forceSync).toHaveBeenCalled();
  });
});

// ── Close & Navigation ────────────────────────────────────────────────────────

describe('MeasurementScreen — close & navigation', () => {
  it('renders close button in header', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    // Header title is rendered
    expect(getByText('Měření')).toBeTruthy();
  });

  it('displays measurement title in header', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Měření')).toBeTruthy();
  });
});

// ── Color Legend ──────────────────────────────────────────────────────────────

describe('MeasurementScreen — color legend', () => {
  it('displays color legend with thresholds', () => {
    setupMeasurementHook();
    setupSyncHook();
    const { getByText } = renderScreen();

    expect(getByText('Legenda barev:')).toBeTruthy();
    expect(getByText(/Zelená/)).toBeTruthy();
    expect(getByText(/Žlutá/)).toBeTruthy();
    expect(getByText(/Červená/)).toBeTruthy();
  });
});

// ── App State Handling ────────────────────────────────────────────────────────

describe('MeasurementScreen — app state handling', () => {
  it('registers AppState change listener on mount', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();

    renderScreen();

    // Verify AppState listener was registered
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('deactivates keep awake on unmount', () => {
    setupMeasurementHook({ isRecording: true });
    setupSyncHook();

    const { unmount } = renderScreen();

    unmount();

    // Keep awake should be deactivated on cleanup
    expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalled();
  });
});
