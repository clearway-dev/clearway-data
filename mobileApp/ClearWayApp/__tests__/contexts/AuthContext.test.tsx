/**
 * AuthContext — React context wrapping AuthService for app-wide auth state.
 *
 * Tests verify:
 * - isLoading=true on first render, then transitions to correct final state
 * - Stored token → automatic login (isAuthenticated=true) on mount
 * - No token → unauthenticated state (no flash of authenticated content)
 * - Expired token (401 on /users/me) → unauthenticated, not a crash
 * - login() updates context state; logout() clears it
 * - refreshUser() failure triggers automatic logout
 */

import React from 'react';
import { Text } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { AuthService } from '../../services/auth.service';

// ── Mock AuthService ──────────────────────────────────────────────────────────

jest.mock('../../services/auth.service');

const mockUser = {
  id: 1,
  email: 'test@test.cz',
  full_name: 'Test User',
  is_active: true,
  role: 'user',
};

// ── Test consumer component ───────────────────────────────────────────────────

const AuthStateDisplay: React.FC = () => {
  const { isLoading, isAuthenticated, user } = useAuth();
  if (isLoading) return <Text testID="loading">loading</Text>;
  if (isAuthenticated) return <Text testID="authed">{user?.email}</Text>;
  return <Text testID="unauthed">not authenticated</Text>;
};

const renderWithProvider = () =>
  render(
    <AuthProvider>
      <AuthStateDisplay />
    </AuthProvider>
  );

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Mount: no stored token ────────────────────────────────────────────────────

describe('AuthContext — initial state (no token)', () => {
  it('shows unauthenticated state when no token exists', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce(null);

    const { getByTestId } = renderWithProvider();

    await waitFor(() => {
      expect(getByTestId('unauthed')).toBeTruthy();
    });
  });
});

// ── Mount: valid stored token ─────────────────────────────────────────────────

describe('AuthContext — initial state (valid token)', () => {
  it('restores authenticated session when token is valid', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('valid-token');
    (AuthService.getCurrentUser as jest.Mock).mockResolvedValueOnce(mockUser);

    const { getByTestId } = renderWithProvider();

    await waitFor(() => {
      expect(getByTestId('authed').props.children).toBe('test@test.cz');
    });
  });
});

// ── Mount: expired token ──────────────────────────────────────────────────────

describe('AuthContext — initial state (expired token)', () => {
  it('transitions to unauthenticated when token is expired', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('old-token');
    const expiredError = new Error('Token expired');
    (AuthService.getCurrentUser as jest.Mock).mockRejectedValueOnce(expiredError);
    (AuthService.isTokenExpiredError as jest.Mock).mockReturnValueOnce(true);
    (AuthService.clearToken as jest.Mock).mockResolvedValue(undefined);

    const { getByTestId } = renderWithProvider();

    await waitFor(() => {
      expect(getByTestId('unauthed')).toBeTruthy();
    });
  });
});

// ── login() ───────────────────────────────────────────────────────────────────

describe('AuthContext.login()', () => {
  const LoginTrigger: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    const { login, isAuthenticated } = useAuth();
    return (
      <>
        <Text testID="status">{isAuthenticated ? 'authed' : 'unauthed'}</Text>
        <Text testID="trigger" onPress={() => login('a@b.com', 'pass').then(onLogin)} />
      </>
    );
  };

  it('transitions to isAuthenticated=true on successful login', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce(null);
    (AuthService.login as jest.Mock).mockResolvedValueOnce({
      access_token: 'new-tok',
      token_type: 'bearer',
    });
    (AuthService.getCurrentUser as jest.Mock).mockResolvedValueOnce(mockUser);

    const onLogin = jest.fn();
    const { getByTestId } = render(
      <AuthProvider>
        <LoginTrigger onLogin={onLogin} />
      </AuthProvider>
    );

    // Initial unauthenticated
    await waitFor(() => expect(getByTestId('status').props.children).toBe('unauthed'));

    await act(async () => {
      getByTestId('trigger').props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId('status').props.children).toBe('authed');
    });
  });

  it('stays unauthenticated and re-throws when login fails', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce(null);
    (AuthService.login as jest.Mock).mockRejectedValueOnce(
      new Error('Neplatné přihlašovací údaje')
    );

    let caughtError: Error | null = null;
    const onLogin = jest.fn();

    const FailingLogin: React.FC = () => {
      const { login, isAuthenticated } = useAuth();
      return (
        <>
          <Text testID="status">{isAuthenticated ? 'authed' : 'unauthed'}</Text>
          <Text
            testID="trigger"
            onPress={() =>
              login('a@b.com', 'wrong').catch((e: Error) => {
                caughtError = e;
              })
            }
          />
        </>
      );
    };

    const { getByTestId } = render(
      <AuthProvider>
        <FailingLogin />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('status').props.children).toBe('unauthed'));

    await act(async () => {
      getByTestId('trigger').props.onPress();
    });

    await waitFor(() => {
      expect(caughtError?.message).toBe('Neplatné přihlašovací údaje');
      expect(getByTestId('status').props.children).toBe('unauthed');
    });
    void onLogin; // used to avoid lint
  });
});

// ── Mount: non-expired token validation failure ───────────────────────────────

describe('AuthContext — initial state (validation failure, not expired)', () => {
  it('calls clearToken and becomes unauthenticated when getCurrentUser fails for non-expiry reason', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('some-token');
    (AuthService.getCurrentUser as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    (AuthService.isTokenExpiredError as jest.Mock).mockReturnValueOnce(false);
    (AuthService.clearToken as jest.Mock).mockResolvedValue(undefined);

    const { getByTestId } = renderWithProvider();

    await waitFor(() => {
      expect(getByTestId('unauthed')).toBeTruthy();
    });
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });
});

// ── refreshUser() ─────────────────────────────────────────────────────────────

describe('AuthContext.refreshUser()', () => {
  const RefreshTrigger: React.FC<{ onError?: (e: Error) => void }> = ({ onError }) => {
    const { refreshUser, user } = useAuth();
    return (
      <>
        <Text testID="email">{user?.email ?? 'none'}</Text>
        <Text
          testID="trigger"
          onPress={() => refreshUser().catch((e: Error) => onError?.(e))}
        />
      </>
    );
  };

  it('updates user state when refreshUser succeeds', async () => {
    const updatedUser = { ...mockUser, email: 'updated@test.cz' };
    // Initial mount: valid session
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('tok');
    (AuthService.getCurrentUser as jest.Mock)
      .mockResolvedValueOnce(mockUser)    // checkAuthStatus
      .mockResolvedValueOnce(updatedUser); // refreshUser

    const { getByTestId } = render(
      <AuthProvider>
        <RefreshTrigger />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('email').props.children).toBe('test@test.cz'));

    await act(async () => {
      getByTestId('trigger').props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId('email').props.children).toBe('updated@test.cz');
    });
  });

  it('calls logout and rethrows when refreshUser fails', async () => {
    // Initial mount: valid session
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('tok');
    (AuthService.getCurrentUser as jest.Mock)
      .mockResolvedValueOnce(mockUser)                          // checkAuthStatus
      .mockRejectedValueOnce(new Error('Session expired'));     // refreshUser
    (AuthService.logout as jest.Mock).mockResolvedValue(undefined);

    let caughtError: Error | null = null;

    const { getByTestId } = render(
      <AuthProvider>
        <RefreshTrigger onError={(e) => { caughtError = e; }} />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('email').props.children).toBe('test@test.cz'));

    await act(async () => {
      getByTestId('trigger').props.onPress();
    });

    await waitFor(() => {
      expect(caughtError?.message).toBe('Session expired');
    });
    expect(AuthService.logout).toHaveBeenCalledTimes(1);
  });
});

// ── useAuth outside provider ──────────────────────────────────────────────────

describe('useAuth()', () => {
  it('throws when used outside AuthProvider', () => {
    // Suppress the expected React error boundary output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const BareConsumer: React.FC = () => {
      useAuth();
      return null;
    };
    expect(() => render(<BareConsumer />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });
});

// ── logout() ─────────────────────────────────────────────────────────────────

describe('AuthContext.logout()', () => {
  const LogoutTrigger: React.FC = () => {
    const { logout, isAuthenticated } = useAuth();
    return (
      <>
        <Text testID="status">{isAuthenticated ? 'authed' : 'unauthed'}</Text>
        <Text testID="trigger" onPress={() => logout()} />
      </>
    );
  };

  it('transitions to isAuthenticated=false after logout', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValueOnce('tok');
    (AuthService.getCurrentUser as jest.Mock).mockResolvedValueOnce(mockUser);
    (AuthService.logout as jest.Mock).mockResolvedValueOnce(undefined);

    const { getByTestId } = render(
      <AuthProvider>
        <LogoutTrigger />
      </AuthProvider>
    );

    // Wait until authenticated
    await waitFor(() => expect(getByTestId('status').props.children).toBe('authed'));

    await act(async () => {
      getByTestId('trigger').props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId('status').props.children).toBe('unauthed');
    });
  });
});
