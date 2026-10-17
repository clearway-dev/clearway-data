/**
 * LoginScreen — what the user actually SEES when a login does not work.
 *
 * The web build has no working Alert, so every problem must also be readable on the screen.
 *
 * Tests verify:
 * - empty fields, wrong credentials, unreachable server, server error: a visible message
 * - the message is understandable (no raw "Failed to fetch"), and names the server address
 * - what the user typed stays in the form after a failure
 * - the message disappears when the user starts correcting the input
 * - the address of the server is shown on the screen
 * - on the web no native Alert is raised (it would do nothing), on native the Alert stays
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { LoginScreen } from '../../screens/LoginScreen';
import { useAuth } from '../../contexts/AuthContext';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const setupLogin = (login: jest.Mock) => {
  (useAuth as jest.Mock).mockReturnValue({ login, isLoading: false, isAuthenticated: false, user: null });
  return login;
};

const fill = (utils: ReturnType<typeof render>, email: string, password: string) => {
  fireEvent.changeText(utils.getByPlaceholderText('vas@email.cz'), email);
  fireEvent.changeText(utils.getByPlaceholderText('••••••••'), password);
};

const submit = async (utils: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.press(utils.getByText('Přihlásit se'));
  });
};

describe('messages on the screen', () => {
  it('asks for the e-mail when it is empty', async () => {
    setupLogin(jest.fn());
    const utils = render(<LoginScreen />);
    fireEvent.changeText(utils.getByPlaceholderText('••••••••'), 'pw');
    await submit(utils);
    expect(utils.getByTestId('loginError')).toBeTruthy();
    expect(utils.getByText('Zadejte prosím email')).toBeTruthy();
  });

  it('asks for the password when it is empty', async () => {
    setupLogin(jest.fn());
    const utils = render(<LoginScreen />);
    fireEvent.changeText(utils.getByPlaceholderText('vas@email.cz'), 'a@b.cz');
    await submit(utils);
    expect(utils.getByText('Zadejte prosím heslo')).toBeTruthy();
  });

  it('says plainly that the credentials are wrong', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(utils.getByText('Nesprávný e-mail nebo heslo.')).toBeTruthy());
  });

  it('names the server when it cannot be reached instead of "Failed to fetch"', async () => {
    setupLogin(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'admin123');
    await submit(utils);
    await waitFor(() => expect(utils.getByTestId('loginError')).toBeTruthy());
    const text = utils.getByTestId('loginError').props.children.props.children as string;
    expect(text).toContain('není dostupný');
    expect(text).toContain('http');
    expect(text).not.toContain('Failed to fetch');
  });

  it('explains a server error after the password was accepted (profile request failed)', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('HTTP 500: Internal Server Error')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'admin123');
    await submit(utils);
    await waitFor(() => expect(utils.getByText(/Server vrátil chybu 500/)).toBeTruthy());
  });

  it('explains a timeout', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Request timed out')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'admin123');
    await submit(utils);
    await waitFor(() => expect(utils.getByText(/Server neodpovídá/)).toBeTruthy());
  });

  it('shows no message before anything went wrong', () => {
    setupLogin(jest.fn());
    const { queryByTestId } = render(<LoginScreen />);
    expect(queryByTestId('loginError')).toBeNull();
  });
});

describe('form state', () => {
  it('keeps what the user typed after a failed login', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(utils.getByTestId('loginError')).toBeTruthy());
    expect(utils.getByPlaceholderText('vas@email.cz').props.value).toBe('admin@clearway.cz');
    expect(utils.getByPlaceholderText('••••••••').props.value).toBe('spatne');
  });

  it('removes the message as soon as the user edits the e-mail', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(utils.getByTestId('loginError')).toBeTruthy());
    fireEvent.changeText(utils.getByPlaceholderText('vas@email.cz'), 'admin@clearway.c');
    expect(utils.queryByTestId('loginError')).toBeNull();
  });

  it('removes the message as soon as the user edits the password', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(utils.getByTestId('loginError')).toBeTruthy());
    fireEvent.changeText(utils.getByPlaceholderText('••••••••'), 'spatn');
    expect(utils.queryByTestId('loginError')).toBeNull();
  });

  it('clears an old message when trying again', async () => {
    const login = jest.fn().mockRejectedValueOnce(new Error('Invalid credentials')).mockResolvedValueOnce(undefined);
    setupLogin(login);
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(utils.getByTestId('loginError')).toBeTruthy());
    await submit(utils);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    expect(utils.queryByTestId('loginError')).toBeNull();
  });

  it('can log in on the second attempt', async () => {
    const login = jest.fn().mockRejectedValueOnce(new Error('Invalid credentials')).mockResolvedValueOnce(undefined);
    setupLogin(login);
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    fireEvent.changeText(utils.getByPlaceholderText('••••••••'), 'admin123');
    await submit(utils);
    expect(login).toHaveBeenLastCalledWith('admin@clearway.cz', 'admin123');
  });
});

describe('server address', () => {
  it('shows which server the app talks to, so a wrong address is obvious', () => {
    setupLogin(jest.fn());
    const { getByTestId } = render(<LoginScreen />);
    expect(getByTestId('serverUrl').props.children.join('')).toMatch(/Server: https?:\/\//);
  });
});

describe('native alert vs. web', () => {
  it('still raises the native alert on a device (and shows the message)', async () => {
    setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
    const utils = render(<LoginScreen />);
    fill(utils, 'admin@clearway.cz', 'spatne');
    await submit(utils);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Chyba přihlášení', 'Nesprávný e-mail nebo heslo.'));
    expect(utils.getByTestId('loginError')).toBeTruthy();
  });

  it('does not raise an alert on the web, where it would do nothing, but shows the message', async () => {
    const spy = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      setupLogin(jest.fn().mockRejectedValue(new Error('Invalid credentials')));
      const utils = render(<LoginScreen />);
      fill(utils, 'admin@clearway.cz', 'spatne');
      await submit(utils);
      await waitFor(() => expect(utils.getByText('Nesprávný e-mail nebo heslo.')).toBeTruthy());
      expect(Alert.alert).not.toHaveBeenCalled();
    } finally {
      spy.restore();
    }
  });
});
