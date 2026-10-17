/**
 * useMeasurement with a connected measuring unit.
 *
 * Key invariants:
 * - real distances from the unit are stored instead of simulated ones
 * - a sample is stored only when BOTH sides are valid (backend and pipeline need both)
 * - the unit is started and stopped together with the recording
 * - without a unit the simulation keeps working exactly as before
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMeasurement } from '../../hooks/useMeasurement';
import { DatabaseService } from '../../services/database.service';
import { makeBle } from '../helpers/merak';

const mockLocationState = {
  location: null as null | { latitude: number; longitude: number; accuracy: number | null; speed: number | null },
  error: null as string | null,
  permissionGranted: true,
};

jest.mock('../../hooks/useLocation', () => ({
  useLocation: jest.fn(() => mockLocationState),
}));
jest.mock('../../services/database.service');
jest.mock('../../contexts/BleContext', () => ({
  useBle: jest.fn(),
}));

import { useLocation } from '../../hooks/useLocation';
import { useBle } from '../../contexts/BleContext';

type SidesInput = { left: number | null; right: number | null; ageMs: number; leftState?: string; rightState?: string };

/** Unless a test says otherwise, a side with a value is 'ok' and a side without one is a 'fault'. */
const withStates = (sides: SidesInput | null) =>
  sides && {
    leftState: sides.left === null ? 'fault' : 'ok',
    rightState: sides.right === null ? 'fault' : 'ok',
    leftIndex: null,
    rightIndex: null,
    ...sides,
  };

const connectedBle = (sides: SidesInput | null) =>
  makeBle({
    status: 'connected',
    deviceName: 'ESP32bt_MeasLength',
    linkOk: true,
    getLatestSides: jest.fn().mockReturnValue(withStates(sides)),
  });

const gpsFix = () => {
  mockLocationState.location = { latitude: 49.74, longitude: 13.37, accuracy: 5, speed: 8 };
  (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
};

const start = async (result: { current: ReturnType<typeof useMeasurement> }) => {
  await act(async () => {
    result.current.startRecording();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationState.location = null;
  (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
  (DatabaseService.insertMeasurement as jest.Mock).mockResolvedValue(undefined);
});

describe('connected measuring unit', () => {
  it('stores the real left/right distances with the GPS fix', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle({ left: 118, right: 132, ageMs: 40 }));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    const saved = (DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0];
    expect(saved).toMatchObject({
      session_id: 'sess-1',
      latitude: 49.74,
      longitude: 13.37,
      distance_left: 118,
      distance_right: 132,
      speed: 8,
      accuracy_gps: 5,
    });
    expect(result.current.lastMeasurement).toEqual({ distance_left: 118, distance_right: 132 });
    expect(result.current.dataSource).toBe('merak');
    expect(result.current.deviceWarning).toBeNull();
  });

  it('starts the unit when recording starts and stops it when recording stops', async () => {
    const ble = connectedBle({ left: 100, right: 100, ageMs: 10 });
    (useBle as jest.Mock).mockReturnValue(ble);
    const { result } = renderHook(() => useMeasurement('sess-1', 'merak'));

    await start(result);
    expect(ble.startMeasurement).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.stopRecording();
    });
    expect(ble.stopMeasurement).toHaveBeenCalledTimes(1);
  });

  it('does not store a sample while the unit sends no fresh data', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle(null));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(result.current.deviceWarning).toBe('Měřák neposílá aktuální data'));
    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
    expect(result.current.skippedCount).toBe(1);
    expect(result.current.measurementCount).toBe(0);
  });

  it('does not store a sample with a missing side and names the side', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle({ left: 118, right: null, ageMs: 20 }));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(result.current.deviceWarning).toBe('Vzorek neuložen (pravá: porucha)'));
    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
  });

  it('names both sides when both are missing', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle({ left: null, right: null, ageMs: 20 }));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(result.current.deviceWarning).toBe('Vzorek neuložen (levá: porucha, pravá: porucha)'));
  });

  it('keeps a distance of 0 cm (valid reading, not "missing")', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle({ left: 0, right: 120, ageMs: 5 }));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    expect((DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0].distance_left).toBe(0);
  });

  it('clears the warning once good data arrives again', async () => {
    const ble = connectedBle(null);
    (useBle as jest.Mock).mockReturnValue(ble);
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(result.current.deviceWarning).not.toBeNull());

    (ble.getLatestSides as jest.Mock).mockReturnValue(withStates({ left: 100, right: 110, ageMs: 5 }));
    act(() => {
      mockLocationState.location = { latitude: 49.741, longitude: 13.371, accuracy: 5, speed: 8 };
      (useLocation as jest.Mock).mockReturnValue({ ...mockLocationState });
    });
    rerender({});
    await waitFor(() => expect(result.current.deviceWarning).toBeNull());
    expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1);
  });

  it('reports a unit that could not be started', async () => {
    const ble = connectedBle({ left: 100, right: 100, ageMs: 5 });
    (ble.startMeasurement as jest.Mock).mockRejectedValue(new Error('Příkaz M: nelze provést'));
    (useBle as jest.Mock).mockReturnValue(ble);
    const { result } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    await waitFor(() => expect(result.current.deviceWarning).toContain('Příkaz M: nelze provést'));
  });

  it('stops the unit when the screen is left', async () => {
    const ble = connectedBle({ left: 100, right: 100, ageMs: 5 });
    (useBle as jest.Mock).mockReturnValue(ble);
    const { unmount } = renderHook(() => useMeasurement('sess-1', 'merak'));
    unmount();
    expect(ble.stopMeasurement).toHaveBeenCalled();
  });
});

describe('sensor states (protocol 2)', () => {
  it('stores a "too close" side as 0 cm (worst case) and warns about it', async () => {
    (useBle as jest.Mock).mockReturnValue(
      connectedBle({ left: null, leftState: 'tooClose', right: 132, ageMs: 20 })
    );
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    const saved = (DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0];
    expect(saved.distance_left).toBe(0);
    expect(saved.distance_right).toBe(132);
    expect(result.current.deviceWarning).toBe('PŘÍLIŠ BLÍZKO (levá strana), uloženo 0 cm');
  });

  it('names both sides when both are too close', async () => {
    (useBle as jest.Mock).mockReturnValue(
      connectedBle({ left: null, leftState: 'tooClose', right: null, rightState: 'tooClose', ageMs: 20 })
    );
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(result.current.deviceWarning).toBe('PŘÍLIŠ BLÍZKO (levá a pravá strana), uloženo 0 cm'));
    const saved = (DatabaseService.insertMeasurement as jest.Mock).mock.calls[0][0];
    expect([saved.distance_left, saved.distance_right]).toEqual([0, 0]);
  });

  it('skips a sample when a side sees nothing in range, and says why', async () => {
    (useBle as jest.Mock).mockReturnValue(
      connectedBle({ left: 118, right: null, rightState: 'noTarget', ageMs: 20 })
    );
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(result.current.deviceWarning).toBe('Vzorek neuložen (pravá: nic v dosahu)'));
    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
    expect(result.current.skippedCount).toBe(1);
  });

  it('stores without a warning when both sides are ok', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedBle({ left: 118, right: 132, ageMs: 20 }));
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    act(() => gpsFix());
    rerender({});
    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    expect(result.current.deviceWarning).toBeNull();
  });
});

describe('no measuring unit connected', () => {
  it('falls back to the simulation and never touches the unit', async () => {
    const ble = makeBle();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { result, rerender } = renderHook(() => useMeasurement('sess-1'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    expect(result.current.dataSource).toBe('simulation');
    expect(ble.startMeasurement).not.toHaveBeenCalled();
    expect(ble.getLatestSides).not.toHaveBeenCalled();
  });
});

describe('chosen data source wins over what happens to be connected', () => {
  it('"simulation" stores test data even with a connected unit and never touches the unit', async () => {
    const ble = connectedBle({ left: 118, right: 132, ageMs: 5 });
    (useBle as jest.Mock).mockReturnValue(ble);
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'simulation'));
    await start(result);
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(DatabaseService.insertMeasurement).toHaveBeenCalledTimes(1));
    expect(result.current.dataSource).toBe('simulation');
    expect(ble.startMeasurement).not.toHaveBeenCalled();
    expect(ble.getLatestSides).not.toHaveBeenCalled();
    await act(async () => {
      result.current.stopRecording();
    });
    expect(ble.stopMeasurement).not.toHaveBeenCalled();
  });

  it('"merak" with the unit gone stores nothing instead of falling back to simulated data', async () => {
    (useBle as jest.Mock).mockReturnValue(makeBle()); // disconnected
    const { result, rerender } = renderHook(() => useMeasurement('sess-1', 'merak'));
    await start(result);
    expect(result.current.deviceWarning).toContain('Měřák není připojený');
    act(() => gpsFix());
    rerender({});

    await waitFor(() => expect(result.current.skippedCount).toBe(1));
    expect(DatabaseService.insertMeasurement).not.toHaveBeenCalled();
    expect(result.current.dataSource).toBe('merak');
    expect(result.current.deviceWarning).toBe('Měřák není připojený, vzorek neuložen');
  });
});
