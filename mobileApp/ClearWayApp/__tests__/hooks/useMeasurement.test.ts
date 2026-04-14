/**
 * useMeasurement — orchestrates START/STOP recording and persists measurements.
 *
 * Key invariants:
 * - startRecording() is a no-op without a sessionId or without permission
 * - A measurement is saved to the DB on every location update while recording
 * - measurementCount increments after each successful insert
 * - lastMeasurement reflects the most recent distance pair
 * - stopRecording() sets isRecording=false regardless of state
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMeasurement } from '../../hooks/useMeasurement';
import { DatabaseService } from '../../services/database.service';

// ── Mock useLocation so we control location / permission state ────────────────

const mockLocationState = {
  location: null as null | {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
  },
  error: null as string | null,
  permissionGranted: false,
};

jest.mock('../../hooks/useLocation', () => ({
  useLocation: jest.fn(() => mockLocationState),
}));

import { useLocation } from '../../hooks/useLocation';

// ── Mock DatabaseService ──────────────────────────────────────────────────────

jest.mock('../../services/database.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

const grantPermission = () => {
  mockLocationState.permissionGranted = true;
  (useLocation as jest.Mock).mockReturnValue(mockLocationState);
};

const setLocation = (lat = 50.0, lon = 14.0) => {
  mockLocationState.location = { latitude: lat, longitude: lon, accuracy: 5, speed: 10 };
  (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
};

const clearLocation = () => {
  mockLocationState.location = null;
  (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationState.location = null;
  mockLocationState.error = null;
  mockLocationState.permissionGranted = false;
  (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
  (DatabaseService.insertMeasurement as jest.Mock).mockResolvedValue(undefined);
});

// ── startRecording guards ─────────────────────────────────────────────────────

describe('useMeasurement.startRecording()', () => {
  it('does nothing when sessionId is null', () => {
    grantPermission();
    const { result } = renderHook(() => useMeasurement(null));

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('does nothing when permission is not granted', () => {
    // permissionGranted stays false
    const { result } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('sets isRecording=true when session and permission are both valid', () => {
    grantPermission();
    const { result } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  it('resets measurementCount to 0 on start', () => {
    grantPermission();
    const { result } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.measurementCount).toBe(0);
  });
});

// ── stopRecording ─────────────────────────────────────────────────────────────

describe('useMeasurement.stopRecording()', () => {
  it('sets isRecording=false', () => {
    grantPermission();
    const { result } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });
});

// ── measurement on location update ───────────────────────────────────────────

describe('useMeasurement — measurement saved on GPS update', () => {
  it('calls DatabaseService.insertMeasurement when recording and location is available', async () => {
    grantPermission();
    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    // Simulate a GPS update by changing location in the mock
    act(() => {
      setLocation(50.0, 14.0);
    });
    rerender({});

    await waitFor(() => {
      expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1);
    });

    const call = (DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0];
    expect(call.session_id).toBe('sess-1');
    expect(call.latitude).toBe(50.0);
    expect(call.longitude).toBe(14.0);
    expect(call.synced).toBeUndefined(); // synced is set by DB layer
  });

  it('increments measurementCount after each insert', async () => {
    grantPermission();
    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    act(() => { setLocation(50.0, 14.0); });
    rerender({});

    await waitFor(() => {
      expect(result.current.measurementCount).toBe(1);
    });
  });

  it('updates lastMeasurement with distance pair', async () => {
    grantPermission();
    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });

    act(() => { setLocation(); });
    rerender({});

    await waitFor(() => {
      expect(result.current.lastMeasurement).not.toBeNull();
      expect(typeof result.current.lastMeasurement!.distance_left).toBe('number');
      expect(typeof result.current.lastMeasurement!.distance_right).toBe('number');
    });
  });

  it('does NOT insert when not recording (isRecording=false)', async () => {
    grantPermission();
    const { rerender } = renderHook(() => useMeasurement('sess-1'));

    // Never start recording, but provide a location
    act(() => { setLocation(); });
    rerender({});

    await act(async () => { await Promise.resolve(); });

    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
  });

  it('does NOT insert when location is null even if recording', async () => {
    grantPermission();
    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });
    // location stays null
    clearLocation();
    rerender({});

    await act(async () => { await Promise.resolve(); });

    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
  });

  it('passes null speed when GPS speed is negative', async () => {
    grantPermission();
    mockLocationState.location = { latitude: 50, longitude: 14, accuracy: 3, speed: -1 };
    (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });

    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));

    act(() => {
      result.current.startRecording();
    });
    rerender({});

    await waitFor(() => {
      expect(DatabaseService.insertMeasurement).toHaveBeenCalled();
    });

    const call = (DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0];
    expect(call.speed).toBeNull();
  });
});
