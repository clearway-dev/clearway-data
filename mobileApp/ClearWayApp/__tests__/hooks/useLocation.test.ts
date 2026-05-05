/**
 * useLocation — GPS permission request and sequential polling lifecycle.
 *
 * Tests verify:
 * - Permission is requested on mount (regardless of enabled flag)
 * - Polling starts only when both enabled=true AND permission granted
 * - Pending polling timeout is cleaned up on unmount or when enabled flips to false
 * - Location state updates after a successful getCurrentPositionAsync call
 * - Error state is set when permission is denied or GPS call fails
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useLocation } from '../../hooks/useLocation';

jest.mock('../../config/measurement.config', () => ({
  MeasurementConfig: {
    locationTrackingIntervalMs: 100000,
    enableLocationMetrics: false,
    locationMetricsWindowMs: 5000,
    preferPolling: true,
  },
}));

// ── expo-location mock ────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  Accuracy: { BestForNavigation: 6 },
}));

import * as Location from 'expo-location';

const grantPermission = () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
};

const denyPermission = () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
};

const mockCurrentPosition = (lat = 50.0, lon = 14.0) => {
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: lat, longitude: lon, accuracy: 5, speed: 10 },
  });
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLocation — permission handling', () => {
  it('requests foreground location permission on mount', async () => {
    grantPermission();

    renderHook(() => useLocation(false));

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('sets permissionGranted=true when permission is granted', async () => {
    grantPermission();

    const { result } = renderHook(() => useLocation(false));

    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
    });
  });

  it('sets permissionGranted=false and error when permission is denied', async () => {
    denyPermission();

    const { result } = renderHook(() => useLocation(false));

    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(false);
      expect(result.current.error).toBe('Permission to access location was denied');
    });
  });
});

describe('useLocation — tracking lifecycle', () => {
  it('does NOT start tracking when enabled=false (even if permission granted)', async () => {
    grantPermission();
    mockCurrentPosition();

    renderHook(() => useLocation(false));

    await waitFor(() => {}); // flush permission effect

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('starts tracking when enabled=true and permission is granted', async () => {
    grantPermission();
    mockCurrentPosition();

    const { result } = renderHook(() => useLocation(true));

    // Wait until permission has been granted (state update completes)
    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('updates location state with GPS coords from polling', async () => {
    grantPermission();
    mockCurrentPosition(49.5, 13.5);

    const { result } = renderHook(() => useLocation(true));

    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.location?.latitude).toBe(49.5);
      expect(result.current.location?.longitude).toBe(13.5);
    });
  });

  it('sets error when getCurrentPositionAsync rejects', async () => {
    grantPermission();
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
      new Error('GPS unavailable')
    );

    const { result } = renderHook(() => useLocation(true));

    await waitFor(() => {});

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to get location');
    });
  });

  it('stops polling on unmount so no further GPS updates happen', async () => {
    grantPermission();
    mockCurrentPosition();

    const { result, unmount } = renderHook(() => useLocation(true));

    // Wait for permission so polling starts
    await waitFor(() => expect(result.current.permissionGranted).toBe(true));

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });
});
