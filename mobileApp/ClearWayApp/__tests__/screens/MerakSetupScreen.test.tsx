/**
 * Measurement setup page - Bluetooth connection of the unit, data mode, firmware generation.
 *
 * Tests verify:
 * - the connect button, and that it becomes "disconnect" once connected
 * - MIN is the default data mode; the switch writes the chosen mode
 * - FW 4.0.0 is the default firmware generation; switching to 3.6.0 and the mismatch warning
 * - the side swap and the link to the service screen
 * - the back button
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MerakSetupScreen } from '../../screens/MerakSetupScreen';
import { useBle } from '../../contexts/BleContext';
import { makeBle } from '../helpers/merak';

jest.mock('../../contexts/BleContext', () => ({ useBle: jest.fn() }));

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'MerakSetup'
>;

const connectedInfo = (protocol: number, firmware: string) => ({
  firmware,
  role: 'MASTER',
  protocol,
  serial: 'AABB',
  devBuild: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useBle as jest.Mock).mockReturnValue(makeBle());
});

describe('page', () => {
  it('has its own title and a back button', () => {
    const { getByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByText('Nastavit měření')).toBeTruthy();
    fireEvent.press(getByText('← Zpět'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('opens the service screen', () => {
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    fireEvent.press(getByTestId('openMerakService'));
    expect(navigation.navigate).toHaveBeenCalledWith('MerakService');
  });
});

describe('connect button', () => {
  it('connects the unit when pressed', () => {
    const ble = makeBle();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakSetupScreen navigation={navigation} />);

    expect(getByText('Připojit měřák')).toBeTruthy();
    fireEvent.press(getByTestId('connectMerakButton'));
    expect(ble.connect).toHaveBeenCalledTimes(1);
  });

  it('turns into a disconnect button once connected', () => {
    const ble = makeBle({ status: 'connected', deviceName: 'ESP32bt_MeasLength', linkOk: true });
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText, queryByText } = render(<MerakSetupScreen navigation={navigation} />);

    expect(getByText('Odpojit měřák')).toBeTruthy();
    expect(queryByText('Připojit měřák')).toBeNull();
    expect(getByTestId('merakStatusText').props.children).toContain('ESP32bt_MeasLength');
    fireEvent.press(getByTestId('connectMerakButton'));
    expect(ble.disconnect).toHaveBeenCalledTimes(1);
    expect(ble.connect).not.toHaveBeenCalled();
  });

  it('is disabled where Bluetooth is not available', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ supported: false }));
    const { getByTestId, getByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByText('○ Bluetooth tu není dostupný')).toBeTruthy();
    expect(getByTestId('connectMerakButton').props.accessibilityState?.disabled).toBe(true);
  });

  it('shows the connection error', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ error: 'Měřák nenalezen' }));
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByTestId('merakError').props.children).toBe('Měřák nenalezen');
  });
});

describe('data mode', () => {
  it('marks MIN (left + right minimum) as the selected default', () => {
    const { getByTestId, getByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByTestId('merakMode-min').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('merakMode-raw').props.accessibilityState.selected).toBe(false);
    expect(getByText('minimum levá + pravá (výchozí)')).toBeTruthy();
  });

  it('writes RAW when the RAW segment is pressed', () => {
    const ble = makeBle();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    fireEvent.press(getByTestId('merakMode-raw'));
    expect(ble.setMode).toHaveBeenCalledWith('raw');
  });

  it('explains what RAW stores', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ mode: 'raw' }));
    const { getByText } = render(<MerakSetupScreen navigation={navigation} />);
    // default FW 4.0.0 = protocol 2: raw frame 27 B
    expect(getByText(/všech 8 senzorů \(27 B\), aplikace uloží minimum/)).toBeTruthy();
  });
});

describe('firmware generation', () => {
  it('defaults to FW 4.0.0 (protocol 2, the firmware on the unit) and describes its frames', () => {
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByTestId('merakProfile-4.0').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('merakProfile-3.6').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('merakProfileNote').props.children).toContain('27 B / 14 B');
  });

  it('describes the 13 B min frame of FW 3.6.0', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ profile: '3.6' }));
    const { getByText, getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByText(/za pravý měřák \(13 B\)/)).toBeTruthy();
    expect(getByTestId('merakProfileNote').props.children).toContain('25 B / 13 B');
  });

  it('switches to FW 3.6.0', () => {
    const ble = makeBle();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    fireEvent.press(getByTestId('merakProfile-3.6'));
    expect(ble.setProfile).toHaveBeenCalledWith('3.6');
  });

  it('never claims that protocol 2 is only prepared any more', () => {
    const { queryByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(queryByText(/příprava/)).toBeNull();
  });

  it('warns when a FW 3.6.0 unit is connected while FW 4.0.0 is selected (the default)', () => {
    (useBle as jest.Mock).mockReturnValue(
      makeBle({
        status: 'connected',
        deviceName: 'ESP32bt_MeasLength',
        linkOk: true,
        deviceInfo: connectedInfo(1, '3.6.0'),
      })
    );
    const { getByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByTestId('merakFirmwareMismatch')).toBeTruthy();
  });

  it('does not warn when the protocol matches the selected version', () => {
    (useBle as jest.Mock).mockReturnValue(
      makeBle({
        status: 'connected',
        deviceName: 'ESP32bt_MeasLength',
        linkOk: true,
        profile: '3.6',
        deviceInfo: connectedInfo(1, '3.6.0'),
      })
    );
    const { queryByTestId } = render(<MerakSetupScreen navigation={navigation} />);
    expect(queryByTestId('merakFirmwareMismatch')).toBeNull();
  });
});

describe('sides', () => {
  it('swaps the sides', () => {
    const ble = makeBle();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByText('Strany: master = levá, slave = pravá')).toBeTruthy();
    fireEvent.press(getByTestId('merakSwapSides'));
    expect(ble.setSwapSides).toHaveBeenCalledWith(true);
  });

  it('shows the swapped assignment', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ swapSides: true }));
    const { getByText } = render(<MerakSetupScreen navigation={navigation} />);
    expect(getByText('Strany: master = pravá, slave = levá')).toBeTruthy();
  });
});
