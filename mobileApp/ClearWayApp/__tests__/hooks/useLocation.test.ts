/**
 * useLocation — GPS permission request and 5 Hz polling lifecycle.
 *
 * Tests verify:
 * - Permission is requested on mount (regardless of enabled flag)
 * - Tracking interval starts only when both enabled=true AND permission granted
 * - Interval is cleaned up on unmount or when enabled flips to false
 * - Location state updates after a successful getCurrentPositionAsync call
 * - Error state is set when permission is denied or GPS call fails
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useLocation } from '../../hooks/useLocation';

// ── expo-location mock ────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { BestForNavigation: 6 },
}));

import * as Location from 'expo-location';

const grantPermission = () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
};

const denyPermission = () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
};

const mockPosition = (lat = 50.0, lon = 14.0) => {
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: lat, longitude: lon, accuracy: 5, speed: 10 },
  });
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useLocation — permission handling', () => {
  it('requests foreground location permission on mount', async () => {
    grantPermission();
    mockPosition();

    renderHook(() => useLocation(false));

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('sets permissionGranted=true when permission is granted', async () => {
    grantPermission();
    mockPosition();

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
  it('does NOT start the GPS interval when enabled=false (even if permission granted)', async () => {
    grantPermission();
    mockPosition();

    renderHook(() => useLocation(false));

    await waitFor(() => {}); // flush permission effect

    jest.advanceTimersByTime(3000);

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('starts the GPS interval when enabled=true and permission is granted', async () => {
    grantPermission();
    mockPosition();

    const { result } = renderHook(() => useLocation(true));

    // Wait until permission has been granted (state update completes)
    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
    });

    // Now the tracking effect has registered the interval — advance past 200 ms
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('updates location state with GPS coords on each tick', async () => {
    grantPermission();
    mockPosition(49.5, 13.5);

    const { result } = renderHook(() => useLocation(true));

    await waitFor(() => {
      expect(result.current.permissionGranted).toBe(true);
    });

    await act(async () => {
      jest.advanceTimersByTime(200);
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
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to get location');
    });
  });

  it('clears the interval on unmount so no further GPS calls happen', async () => {
    grantPermission();
    mockPosition();

    const { result, unmount } = renderHook(() => useLocation(true));

    // Wait for permission so the interval is registered
    await waitFor(() => expect(result.current.permissionGranted).toBe(true));

    // Allow one tick so we know the interval works
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    const callsAfterOneTick = (Location.getCurrentPositionAsync as jest.Mock).mock.calls.length;

    unmount();

    // Advance further — no new calls after unmount
    jest.advanceTimersByTime(5000);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(callsAfterOneTick);
  });
});
