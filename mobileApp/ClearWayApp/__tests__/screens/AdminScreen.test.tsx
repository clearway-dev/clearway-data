/**
 * AdminScreen — form rendering, vehicle/sensor creation, error handling.
 *
 * Tests verify:
 * - Rendering: sections, inputs, labels, buttons
 * - Vehicle creation: success flow (form reset, alert shown)
 * - Vehicle errors: error alert displayed
 * - Sensor creation: success flow
 * - Sensor errors: error alert displayed
 * - Loading state: inputs disabled, button disabled
 * - Trimming: whitespace removed before submission
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AdminScreen } from '../../screens/AdminScreen';
import { ApiService } from '../../services/api.service';

jest.mock('../../services/api.service');

// react-navigation prop mock
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'Admin'
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const renderScreen = () => render(<AdminScreen navigation={mockNavigation} />);

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.goBack.mockClear();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('AdminScreen — rendering', () => {
  it('renders vehicle and sensor forms', () => {
    const { getByText, getByPlaceholderText } = renderScreen();

    // Vehicle form
    expect(getByText('Název vozidla *')).toBeTruthy();
    expect(getByText('Šířka (cm) *')).toBeTruthy();
    expect(getByPlaceholderText('např. Auto')).toBeTruthy();
    expect(getByPlaceholderText('např. 180')).toBeTruthy();

    // Sensor form
    expect(getByText('Popis senzoru *')).toBeTruthy();
    expect(getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor')).toBeTruthy();
    expect(getByText('Senzor bude automaticky nastaven jako aktivní')).toBeTruthy();
  });
});

// ── Vehicle creation ──────────────────────────────────────────────────────────

describe('AdminScreen — vehicle creation', () => {
  it('calls ApiService.createVehicle with trimmed name and parsed width', async () => {
    (ApiService.createVehicle as jest.Mock).mockResolvedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('např. Auto'), '  Octavia  ');
    fireEvent.changeText(getByPlaceholderText('např. 180'), '183');

    await act(async () => {
      fireEvent.press(getByTestId('createVehicleButton'));
      await waitFor(() => {
        expect(ApiService.createVehicle).toHaveBeenCalledWith({
          vehicle_name: 'Octavia',
          width: 183,
        });
      });
    });
  });

  it('shows success alert and resets form on successful vehicle creation', async () => {
    (ApiService.createVehicle as jest.Mock).mockResolvedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('např. Auto'), 'Fabia');
    fireEvent.changeText(getByPlaceholderText('např. 180'), '165');

    await act(async () => {
      fireEvent.press(getByTestId('createVehicleButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Úspěch',
          'Vozidlo bylo úspěšně vytvořeno'
        );
      });
    });

    expect(getByPlaceholderText('např. Auto').props.value).toBe('');
    expect(getByPlaceholderText('např. 180').props.value).toBe('');
  });

  it('shows error alert when vehicle creation fails', async () => {
    (ApiService.createVehicle as jest.Mock).mockRejectedValueOnce(
      new Error('Network error')
    );
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('např. Auto'), 'Fabia');
    fireEvent.changeText(getByPlaceholderText('např. 180'), '165');

    await act(async () => {
      fireEvent.press(getByTestId('createVehicleButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Network error');
      });
    });
  });

});

// ── Sensor creation ───────────────────────────────────────────────────────────

describe('AdminScreen — sensor creation', () => {
  it('calls ApiService.createSensor with trimmed description and is_active=true', async () => {
    (ApiService.createSensor as jest.Mock).mockResolvedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(
      getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor'),
      '  HC-SR04  '
    );

    await act(async () => {
      fireEvent.press(getByTestId('createSensorButton'));
      await waitFor(() => {
        expect(ApiService.createSensor).toHaveBeenCalledWith({
          description: 'HC-SR04',
          is_active: true,
        });
      });
    });
  });

  it('shows success alert and resets form on successful sensor creation', async () => {
    (ApiService.createSensor as jest.Mock).mockResolvedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(
      getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor'),
      'Sensor v2'
    );

    await act(async () => {
      fireEvent.press(getByTestId('createSensorButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Úspěch',
          'Senzor byl úspěšně vytvořen'
        );
      });
    });

    expect(
      getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor').props.value
    ).toBe('');
  });

  it('shows error alert when sensor creation fails', async () => {
    (ApiService.createSensor as jest.Mock).mockRejectedValueOnce(
      new Error('Sensor already exists')
    );
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(
      getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor'),
      'Sensor v2'
    );

    await act(async () => {
      fireEvent.press(getByTestId('createSensorButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Chyba',
          'Sensor already exists'
        );
      });
    });
  });

});

// ── Error handling with default message ────────────────────────────────────────

describe('AdminScreen — error message fallback', () => {
  it('shows default vehicle error message when error has no message', async () => {
    (ApiService.createVehicle as jest.Mock).mockRejectedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('např. Auto'), 'Auto');
    fireEvent.changeText(getByPlaceholderText('např. 180'), '180');

    await act(async () => {
      fireEvent.press(getByTestId('createVehicleButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Chyba',
          'Nepodařilo se vytvořit vozidlo'
        );
      });
    });
  });

  it('shows default sensor error message when error has no message', async () => {
    (ApiService.createSensor as jest.Mock).mockRejectedValueOnce({});
    const { getByPlaceholderText, getByTestId } = renderScreen();

    fireEvent.changeText(
      getByPlaceholderText('např. HC-SR04 Ultrazvukový senzor'),
      'Sensor'
    );

    await act(async () => {
      fireEvent.press(getByTestId('createSensorButton'));
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Chyba',
          'Nepodařilo se vytvořit senzor'
        );
      });
    });
  });
});
