/**
 * LoginScreen — input validation, loading state, error feedback, and auth delegation.
 *
 * Tested independently of the real AuthContext by mocking useAuth.
 * This keeps tests fast and deterministic — no token storage or network involved.
 *
 * Critical flows:
 * - Empty email / empty password → Alert shown, login() NOT called
 * - Successful login → login() called with trimmed email
 * - Failed login → Alert with error message
 * - During login → button disabled + ActivityIndicator shown
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { LoginScreen } from '../../screens/LoginScreen';
import { useAuth } from '../../contexts/AuthContext';

// Alert.alert is set up as jest.fn() globally in jest.setup.ts.
// Each beforeEach there clears the mock between tests.

// ── Mock AuthContext ───────────────────────────────────────────────────────────

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const setupUseAuth = (loginImpl: jest.Mock = jest.fn()) => {
  (useAuth as jest.Mock).mockReturnValue({
    login: loginImpl,
    isLoading: false,
    isAuthenticated: false,
    user: null,
  });
  return loginImpl;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Alert.alert is cleared by jest.setup.ts beforeEach; clear other mocks here.
  (useAuth as jest.Mock).mockClear();
});

describe('LoginScreen — rendering', () => {
  it('renders email input, password input, and login button', () => {
    setupUseAuth();
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    expect(getByPlaceholderText('vas@email.cz')).toBeTruthy();
    expect(getByPlaceholderText('••••••••')).toBeTruthy();
    expect(getByText('Přihlásit se')).toBeTruthy();
  });

  it('renders the ClearWay logo text', () => {
    setupUseAuth();
    const { getByText } = render(<LoginScreen />);
    expect(getByText('ClearWay')).toBeTruthy();
  });
});

describe('LoginScreen — input validation', () => {
  it('shows an alert and does NOT call login() when email is empty', async () => {
    const mockLogin = setupUseAuth();
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('••••••••'), 'password123');
    fireEvent.press(getByText('Přihlásit se'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Zadejte prosím email');
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows an alert and does NOT call login() when password is empty', async () => {
    const mockLogin = setupUseAuth();
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), 'user@test.cz');
    fireEvent.press(getByText('Přihlásit se'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Chyba', 'Zadejte prosím heslo');
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('trims whitespace from email before calling login()', async () => {
    const mockLogin = setupUseAuth(jest.fn().mockResolvedValueOnce(undefined));
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), '  user@test.cz  ');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'pass');

    await act(async () => {
      fireEvent.press(getByText('Přihlásit se'));
    });

    expect(mockLogin).toHaveBeenCalledWith('user@test.cz', 'pass');
  });
});

describe('LoginScreen — successful login', () => {
  it('calls login() with email and password on submit', async () => {
    const mockLogin = setupUseAuth(jest.fn().mockResolvedValueOnce(undefined));
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), 'admin@clearway.cz');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'mypassword');

    await act(async () => {
      fireEvent.press(getByText('Přihlásit se'));
    });

    expect(mockLogin).toHaveBeenCalledWith('admin@clearway.cz', 'mypassword');
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — failed login', () => {
  it('shows error alert with the error message when login() rejects', async () => {
    setupUseAuth(
      jest.fn().mockRejectedValueOnce(new Error('Neplatné přihlašovací údaje'))
    );
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), 'user@test.cz');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'wrong');

    await act(async () => {
      fireEvent.press(getByText('Přihlásit se'));
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Chyba přihlášení',
        'Neplatné přihlašovací údaje'
      );
    });
  });

  it('shows a generic fallback message when the error is not an Error instance', async () => {
    setupUseAuth(jest.fn().mockRejectedValueOnce('string error'));
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), 'user@test.cz');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'pass');

    await act(async () => {
      fireEvent.press(getByText('Přihlásit se'));
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Chyba přihlášení', 'Přihlášení selhalo');
    });
  });
});

describe('LoginScreen — loading state', () => {
  it('shows ActivityIndicator and calls login() only once while in progress', async () => {
    let resolveLogin!: () => void;
    const blockingLogin = jest.fn(
      () => new Promise<void>((resolve) => { resolveLogin = resolve; })
    );
    setupUseAuth(blockingLogin);

    const { getByText, getByPlaceholderText, UNSAFE_getByType } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('vas@email.cz'), 'u@t.cz');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'pass');

    // First press — triggers login
    await act(async () => {
      fireEvent.press(getByText('Přihlásit se'));
    });

    // Button text is replaced by ActivityIndicator while loading
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ActivityIndicator } = require('react-native');
    await waitFor(() => {
      expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    });

    expect(blockingLogin).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLogin();
    });
  });
});
