/**
 * SetupScreen (START) — vehicle and measuring unit selection, session creation, navigation.
 *
 * The "Měřák" choice is either the connected measuring unit or the built-in test generator
 * (random data). Each has its own backend sensor record, found or (for admins) created on demand.
 *
 * Tests verify:
 * - loading, API data loading, error handling
 * - default source: connected unit if connected, otherwise test data
 * - session creation maps the source to the right sensor record (and creates it when missing)
 * - a non-admin gets a clear message instead of a failed request when the record is missing
 * - the connected unit is required for "Připojený měřák" (create and start are blocked otherwise)
 * - session restore, "session already exists", configuration change
 * - navigation passes the chosen data source to the measurement
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SetupScreen } from '../../screens/SetupScreen';
import { ApiService } from '../../services/api.service';
import { SessionStorageService } from '../../services/session-storage.service';
import { TEST_SENSOR_DESCRIPTION } from '../../services/merak/sensor-records';
import { useAuth } from '../../contexts/AuthContext';
import { useBle } from '../../contexts/BleContext';
import { makeBle } from '../helpers/merak';

jest.mock('../../services/api.service');
jest.mock('../../services/session-storage.service');
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../contexts/BleContext', () => ({ useBle: jest.fn() }));

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'Setup'
> & { navigate: jest.Mock };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockVehicles = [
  { id: 'v1', vehicle_name: 'Octavia', width: 183 },
  { id: 'v2', vehicle_name: 'Fabia', width: 165 },
];

const sensor = (id: string, description: string) => ({
  id,
  description,
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
});

const TEST_SENSOR = sensor('s-test', TEST_SENSOR_DESCRIPTION);
const MERAK_SENSOR = sensor('s-merak', 'Měřák ESP32bt_MeasLength SN AABBCCDDEEFF');
const OTHER_SENSOR = sensor('s-other', 'Test Sensor for Bulk Data');

const connectedUnit = () =>
  makeBle({
    status: 'connected',
    deviceName: 'ESP32bt_MeasLength',
    linkOk: true,
    deviceInfo: { firmware: '4.0.0', role: 'MASTER', protocol: 2, serial: 'AABBCCDDEEFF', devBuild: true },
  });

const setAdmin = (admin: boolean) =>
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: 1, email: 'a@b.cz', full_name: null, is_active: true, role: admin ? 'admin' : 'dispatcher' },
  });

const setupMocks = (sensors = [OTHER_SENSOR, TEST_SENSOR, MERAK_SENSOR]) => {
  (ApiService.getVehicles as jest.Mock).mockResolvedValue(mockVehicles);
  (ApiService.getSensors as jest.Mock).mockResolvedValue(sensors);
  (ApiService.createSession as jest.Mock).mockResolvedValue({ id: 'sess-new-123' });
  (ApiService.createSensor as jest.Mock).mockImplementation(async (req: { description: string }) =>
    sensor('s-created', req.description)
  );
  (SessionStorageService.loadSession as jest.Mock).mockResolvedValue(null);
  (SessionStorageService.loadLastSelection as jest.Mock).mockResolvedValue(null);
  (SessionStorageService.saveSession as jest.Mock).mockResolvedValue(undefined);
  (SessionStorageService.saveLastSelection as jest.Mock).mockResolvedValue(undefined);
};

const renderScreen = () => render(<SetupScreen navigation={mockNavigation} />);

const ready = async (utils: ReturnType<typeof render>) => {
  await waitFor(() => expect(utils.getByTestId('createSessionButton')).toBeTruthy());
};

const press = async (utils: ReturnType<typeof render>, testID: string) => {
  await act(async () => {
    fireEvent.press(utils.getByTestId(testID));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  setupMocks();
  setAdmin(true);
  (useBle as jest.Mock).mockReturnValue(makeBle());
});

// ── Initialization ────────────────────────────────────────────────────────────

describe('SetupScreen — initialization', () => {
  it('shows loading indicator during initialization', () => {
    (ApiService.getVehicles as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const { getByText, queryByText } = renderScreen();
    expect(getByText('Inicializace...')).toBeTruthy();
    expect(queryByText('Vozidlo:')).toBeFalsy();
  });

  it('loads vehicles and sensors from the API and shows the vehicle and unit choice', async () => {
    const utils = renderScreen();
    await ready(utils);
    expect(ApiService.getVehicles).toHaveBeenCalledTimes(1);
    expect(ApiService.getSensors).toHaveBeenCalledTimes(1);
    expect(utils.getByText('Vozidlo:')).toBeTruthy();
    expect(utils.getByText('Měřák:')).toBeTruthy();
  });

  it('shows an error alert on API initialization failure but still shows the screen', async () => {
    (ApiService.getVehicles as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    const { getByText } = renderScreen();
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Nepodařilo se inicializovat aplikaci. Zkontrolujte internetové připojení.')
    );
    expect(getByText('Vozidlo:')).toBeTruthy();
  });

  it('shows "Žádná vozidla" when no vehicles are available', async () => {
    (ApiService.getVehicles as jest.Mock).mockResolvedValueOnce([]);
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Žádná vozidla k dispozici')).toBeTruthy());
  });
});

// ── Unit choice ───────────────────────────────────────────────────────────────

describe('SetupScreen — measuring unit choice', () => {
  it('offers exactly the connected unit and the test generator', async () => {
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByTestId('source-merak')).toBeTruthy();
    expect(utils.getByTestId('source-simulation')).toBeTruthy();
    expect(utils.getByText('Připojený měřák')).toBeTruthy();
    expect(utils.getByText('Testovací')).toBeTruthy();
    expect(utils.getByText('náhodná data')).toBeTruthy();
  });

  it('defaults to test data when no unit is connected', async () => {
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByTestId('source-simulation').props.accessibilityState.selected).toBe(true);
    expect(utils.getByText('nepřipojen')).toBeTruthy();
  });

  it('defaults to the connected unit and shows its name, firmware and serial number', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedUnit());
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByTestId('source-merak').props.accessibilityState.selected).toBe(true);
    expect(([] as unknown[]).concat(utils.getByTestId('sourceInfo').props.children).join('')).toBe(
      '● ESP32bt_MeasLength · FW 4.0.0 · SN AABBCCDDEEFF'
    );
  });

  it('explains that test data are stored separately', async () => {
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByTestId('sourceInfo').props.children).toContain('odděleně');
  });

  it('offers to connect the unit when it is chosen but not connected', async () => {
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'source-merak');
    expect(utils.getByTestId('sourceInfo').props.children).toContain('Měřák není připojený');
    await press(utils, 'connectMerakFromSetup');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('MerakSetup');
  });

  it('remembers the chosen source', async () => {
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'source-merak');
    expect(SessionStorageService.saveLastSelection).toHaveBeenLastCalledWith('v1', 'source:merak');
  });

  it('restores the last chosen source', async () => {
    (SessionStorageService.loadLastSelection as jest.Mock).mockResolvedValueOnce({ vehicleId: 'v2', sensorId: 'source:merak' });
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByTestId('source-merak').props.accessibilityState.selected).toBe(true);
  });
});

// ── Session creation ──────────────────────────────────────────────────────────

describe('SetupScreen — session creation', () => {
  it('uses the test sensor record for test data', async () => {
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() => expect(ApiService.createSession).toHaveBeenCalledWith('v1', 's-test'));
    expect(ApiService.createSensor).not.toHaveBeenCalled();
    expect(SessionStorageService.saveSession).toHaveBeenCalledWith('sess-new-123', 'v1', 's-test');
  });

  it('uses the record of the connected unit, found by its serial number', async () => {
    (useBle as jest.Mock).mockReturnValue(connectedUnit());
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() => expect(ApiService.createSession).toHaveBeenCalledWith('v1', 's-merak'));
    expect(ApiService.createSensor).not.toHaveBeenCalled();
  });

  it('creates the test sensor record once when it does not exist yet (admin)', async () => {
    setupMocks([OTHER_SENSOR]);
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() =>
      expect(ApiService.createSensor).toHaveBeenCalledWith({ description: TEST_SENSOR_DESCRIPTION, is_active: true })
    );
    await waitFor(() => expect(ApiService.createSession).toHaveBeenCalledWith('v1', 's-created'));
  });

  it('creates the record of a new unit with its serial number (admin)', async () => {
    setupMocks([OTHER_SENSOR, TEST_SENSOR]);
    (useBle as jest.Mock).mockReturnValue(connectedUnit());
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() =>
      expect(ApiService.createSensor).toHaveBeenCalledWith({
        description: 'Měřák ESP32bt_MeasLength SN AABBCCDDEEFF',
        is_active: true,
      })
    );
    await waitFor(() => expect(ApiService.createSession).toHaveBeenCalledWith('v1', 's-created'));
  });

  it('never stores test data under another sensor (e.g. the seeded bulk data sensor)', async () => {
    setupMocks([OTHER_SENSOR]);
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() => expect(ApiService.createSession).toHaveBeenCalled());
    expect(ApiService.createSession).not.toHaveBeenCalledWith('v1', 's-other');
  });

  it('tells a non-admin user that the record is missing instead of sending a doomed request', async () => {
    setupMocks([OTHER_SENSOR]);
    setAdmin(false);
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Chybí senzor na serveru', expect.stringContaining(TEST_SENSOR_DESCRIPTION))
    );
    expect(ApiService.createSensor).not.toHaveBeenCalled();
    expect(ApiService.createSession).not.toHaveBeenCalled();
  });

  it('does not create a session for the unit while it is not connected', async () => {
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'source-merak');
    await press(utils, 'createSessionButton');
    expect(Alert.alert).toHaveBeenCalledWith('Měřák není připojený', expect.any(String), expect.any(Array));
    expect(ApiService.createSession).not.toHaveBeenCalled();
  });

  it('shows an error alert when session creation fails', async () => {
    (ApiService.createSession as jest.Mock).mockRejectedValueOnce(new Error('API error'));
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Nepodařilo se vytvořit novou jízdu. Zkontrolujte připojení k serveru.')
    );
  });

  it('shows the success card with the session id after creation', async () => {
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    await waitFor(() => {
      expect(utils.getByText('sess-new-123')).toBeTruthy();
      expect(utils.getByText('✓ Jízda připravena')).toBeTruthy();
    });
  });
});

// ── Restore and configuration change ──────────────────────────────────────────

describe('SetupScreen — restore and configuration change', () => {
  const testSession = { sessionId: 'sess-abc-123', vehicleId: 'v1', sensorId: 's-test' };
  const merakSession = { sessionId: 'sess-merak-1', vehicleId: 'v1', sensorId: 's-merak' };

  it('restores a test-data session as ready', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce(testSession);
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('sess-abc-123')).toBeTruthy());
    expect(utils.getByText('✓ Jízda připravena')).toBeTruthy();
    expect(utils.getByTestId('source-simulation').props.accessibilityState.selected).toBe(true);
  });

  it('restores a unit session as the unit source, also while the unit is disconnected', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce(merakSession);
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('sess-merak-1')).toBeTruthy());
    expect(utils.getByTestId('source-merak').props.accessibilityState.selected).toBe(true);
    expect(utils.getByText('✓ Jízda připravena')).toBeTruthy();
  });

  it('asks before replacing an existing session with the same configuration', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce(testSession);
    const utils = renderScreen();
    await ready(utils);
    await press(utils, 'createSessionButton');
    expect(Alert.alert).toHaveBeenCalledWith('Session již existuje', expect.stringContaining('Session ID'), expect.any(Array));
  });

  it('asks for a new session when the source is switched', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce(testSession);
    (useBle as jest.Mock).mockReturnValue(connectedUnit());
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('✓ Jízda připravena')).toBeTruthy());
    await press(utils, 'source-merak');
    expect(utils.getByText('⚠ Konfigurace se změnila - vygenerujte novou jízdu')).toBeTruthy();
    expect(utils.getByTestId('startMeasurementButton').props.accessibilityState?.disabled).toBe(true);
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('SetupScreen — navigation', () => {
  it('starts a test-data measurement with dataSource "simulation"', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce({ sessionId: 'sess-abc-123', vehicleId: 'v1', sensorId: 's-test' });
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('✓ Jízda připravena')).toBeTruthy());
    await press(utils, 'startMeasurementButton');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Measurement', {
      sessionId: 'sess-abc-123',
      vehicleId: 'v1',
      sensorId: 's-test',
      dataSource: 'simulation',
    });
  });

  it('starts a unit measurement with dataSource "merak"', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce({ sessionId: 'sess-merak-1', vehicleId: 'v1', sensorId: 's-merak' });
    (useBle as jest.Mock).mockReturnValue(connectedUnit());
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('✓ Jízda připravena')).toBeTruthy());
    await press(utils, 'startMeasurementButton');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Measurement', {
      sessionId: 'sess-merak-1',
      vehicleId: 'v1',
      sensorId: 's-merak',
      dataSource: 'merak',
    });
  });

  it('does not start a unit measurement while the unit is disconnected', async () => {
    (SessionStorageService.loadSession as jest.Mock).mockResolvedValueOnce({ sessionId: 'sess-merak-1', vehicleId: 'v1', sensorId: 's-merak' });
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByText('✓ Jízda připravena')).toBeTruthy());
    await press(utils, 'startMeasurementButton');
    expect(Alert.alert).toHaveBeenCalledWith('Měřák není připojený', expect.any(String), expect.any(Array));
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Measurement', expect.any(Object));
  });

  it('does not navigate without a session and shows the hint', async () => {
    const utils = renderScreen();
    await ready(utils);
    expect(utils.getByText('Vygenerujte jízdu tlačítkem "Vytvořit jízdu"')).toBeTruthy();
    await press(utils, 'startMeasurementButton');
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Measurement', expect.any(Object));
  });
});
