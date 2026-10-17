/**
 * Home screen - entry point to the measurement setup.
 *
 * Tests verify:
 * - the Bluetooth / unit settings are NOT on the home page, only a "Nastavit měření" button
 * - the button opens its own page
 * - the unit name appears in the top bar next to the logged-in user, only while connected
 * - the existing START button keeps working
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeScreen } from '../../screens/HomeScreen';
import { useAuth } from '../../contexts/AuthContext';
import { useBle } from '../../contexts/BleContext';
import { makeBle } from '../helpers/merak';

jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../contexts/BleContext', () => ({ useBle: jest.fn() }));

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'Home'
>;

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: 1, email: 'admin@clearway.cz', full_name: null, is_active: true, role: 'admin' },
    logout: jest.fn(),
  });
  (useBle as jest.Mock).mockReturnValue(makeBle());
});

describe('setup button', () => {
  it('opens the measurement setup page', () => {
    const { getByTestId, getByText } = render(<HomeScreen navigation={navigation} />);
    expect(getByText('Nastavit měření')).toBeTruthy();
    fireEvent.press(getByTestId('openMerakSetup'));
    expect(navigation.navigate).toHaveBeenCalledWith('MerakSetup');
  });

  it('keeps the Bluetooth controls off the home page', () => {
    const { queryByTestId, queryByText } = render(<HomeScreen navigation={navigation} />);
    expect(queryByTestId('connectMerakButton')).toBeNull();
    expect(queryByTestId('merakConnectCard')).toBeNull();
    expect(queryByText('Připojit měřák')).toBeNull();
    expect(queryByTestId('merakMode-raw')).toBeNull();
  });

  it('still offers START and the other buttons', () => {
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    expect(getByText('START')).toBeTruthy();
    expect(getByText('Nezpracovaná data')).toBeTruthy();
    expect(getByText('Admin panel')).toBeTruthy();
    fireEvent.press(getByText('START'));
    expect(navigation.navigate).toHaveBeenCalledWith('Setup');
  });
});

describe('top bar', () => {
  it('shows the unit name next to the logged-in user while connected', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ status: 'connected', deviceName: 'ESP32bt_MeasLength', linkOk: true }));
    const { getByTestId, getByText } = render(<HomeScreen navigation={navigation} />);

    expect(getByText('admin@clearway.cz')).toBeTruthy();
    expect(getByTestId('headerMerakName').props.children.join('')).toContain('ESP32bt_MeasLength');
  });

  it('marks a connected unit whose heartbeat stopped', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ status: 'connected', deviceName: 'ESP32bt_MeasLength', linkOk: false }));
    const { getByTestId } = render(<HomeScreen navigation={navigation} />);
    expect(getByTestId('headerMerakName').props.children.join('')).toContain('○');
  });

  it('shows nothing about the unit when it is not connected', () => {
    const { queryByTestId } = render(<HomeScreen navigation={navigation} />);
    expect(queryByTestId('headerMerakName')).toBeNull();
  });

  it('does not show it while only connecting', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle({ status: 'connecting' }));
    const { queryByTestId } = render(<HomeScreen navigation={navigation} />);
    expect(queryByTestId('headerMerakName')).toBeNull();
  });
});
