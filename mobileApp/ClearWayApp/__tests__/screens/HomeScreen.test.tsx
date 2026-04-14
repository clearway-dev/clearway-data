/**
 * HomeScreen — user info display, navigation, logout flow, admin panel visibility.
 *
 * Tests verify:
 * - User email displayed from context
 * - Logo and navigation buttons rendered
 * - Setup button navigates to Setup screen
 * - SyncErrors button navigates to SyncErrors screen
 * - Admin button shown only for users with role='admin'
 * - Logout button shows confirmation alert
 * - On confirm: logout() called, loading state shown, error handling
 * - Non-admin users don't see admin button
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { HomeScreen } from '../../screens/HomeScreen';
import { useAuth } from '../../contexts/AuthContext';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// react-navigation prop mock
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'Home'
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockUser = {
  id: 1,
  email: 'user@example.cz',
  full_name: 'Test User',
  is_active: true,
  role: 'user',
};

const mockAdminUser = {
  ...mockUser,
  email: 'admin@example.cz',
  role: 'admin',
};

const setupUseAuth = (user = mockUser, logoutImpl = jest.fn()) => {
  (useAuth as jest.Mock).mockReturnValue({
    user,
    logout: logoutImpl,
    isLoading: false,
    isAuthenticated: true,
  });
  return logoutImpl;
};

const renderScreen = () => render(<HomeScreen navigation={mockNavigation} />);

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.navigate.mockClear();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('HomeScreen — rendering', () => {
  it('displays user email in header', () => {
    setupUseAuth(mockUser);
    const { getByText } = renderScreen();

    expect(getByText('Přihlášen jako')).toBeTruthy();
    expect(getByText('user@example.cz')).toBeTruthy();
  });

  it('displays logo and subtitle', () => {
    setupUseAuth();
    const { getByText } = renderScreen();

    expect(getByText('ClearWay')).toBeTruthy();
    expect(getByText('Měření průjezdnosti ulic')).toBeTruthy();
  });

  it('renders all buttons for regular user', () => {
    setupUseAuth();
    const { getByText, queryByText } = renderScreen();

    expect(getByText('START')).toBeTruthy();
    expect(getByText('Nezpracovaná data')).toBeTruthy();
    expect(queryByText('Admin panel')).toBeFalsy();
    expect(getByText('Odhlásit')).toBeTruthy();
  });

  it('renders admin button only for admin user', () => {
    setupUseAuth(mockAdminUser);
    const { getByText } = renderScreen();

    expect(getByText('Admin panel')).toBeTruthy();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('HomeScreen — navigation', () => {
  it('navigates to Setup when START button is pressed', async () => {
    setupUseAuth();
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('START'));
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith('Setup');
  });

  it('navigates to SyncErrors when "Nezpracovaná data" button is pressed', async () => {
    setupUseAuth();
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Nezpracovaná data'));
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith('SyncErrors');
  });

  it('navigates to Admin when admin button is pressed', async () => {
    setupUseAuth(mockAdminUser);
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Admin panel'));
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith('Admin');
  });
});

// ── Logout flow ───────────────────────────────────────────────────────────────

describe('HomeScreen — logout flow', () => {
  it('shows confirmation alert when logout button is pressed', async () => {
    setupUseAuth();
    const { getByTestId } = renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('logoutButton'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Odhlásit se',
      'Opravdu se chcete odhlásit?',
      expect.any(Array)
    );
  });

  it('calls logout when confirm button is pressed in alert', async () => {
    const mockLogout = setupUseAuth();
    mockLogout.mockResolvedValueOnce(undefined);
    const { getByText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByText('Odhlásit'));
    });

    // Get the confirm button from Alert.alert arguments
    const alertArgs = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirmButton = alertArgs.find((btn: any) => btn.text === 'Odhlásit');

    await act(async () => {
      confirmButton.onPress();
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('shows error alert when logout fails', async () => {
    const mockLogout = jest.fn().mockRejectedValueOnce(new Error('Logout failed'));
    setupUseAuth(mockUser, mockLogout);
    const { getByTestId } = renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('logoutButton'));
    });

    const alertArgs = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirmButton = alertArgs.find((btn: any) => btn.text === 'Odhlásit');

    // Reset mock to count the error alert separately
    (Alert.alert as jest.Mock).mockClear();

    await act(async () => {
      confirmButton.onPress();
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Odhlášení selhalo');
      });
    });
  });

  it('shows alert has correct structure (Zrušit and Odhlásit buttons)', async () => {
    setupUseAuth();
    const { getByTestId } = renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('logoutButton'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Odhlásit se',
      'Opravdu se chcete odhlásit?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Zrušit' }),
        expect.objectContaining({ text: 'Odhlásit' }),
      ])
    );
  });

  it('calls logout when confirmed and logout resolves successfully', async () => {
    const mockLogout = jest.fn().mockResolvedValueOnce(undefined);
    setupUseAuth(mockUser, mockLogout);
    const { getByTestId } = renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('logoutButton'));
    });

    const alertArgs = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirmButton = alertArgs.find((btn: any) => btn.text === 'Odhlásit');

    await act(async () => {
      confirmButton.onPress();
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1);
      });
    });
  });
});

// ── Admin visibility ──────────────────────────────────────────────────────────

describe('HomeScreen — admin panel visibility', () => {
  it('hides admin button for non-admin user', () => {
    setupUseAuth(mockUser);
    const { queryByText } = renderScreen();

    expect(queryByText('Admin panel')).toBeFalsy();
  });

  it('shows admin button for admin user', () => {
    setupUseAuth(mockAdminUser);
    const { getByText } = renderScreen();

    expect(getByText('Admin panel')).toBeTruthy();
  });
});
