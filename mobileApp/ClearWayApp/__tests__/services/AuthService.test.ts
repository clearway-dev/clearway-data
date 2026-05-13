/**
 * AuthService — login, token lifecycle, and expiry handling.
 *
 * These tests guard against regressions in:
 * - Correct form-encoded POST to /auth/login/access-token
 * - Token stored securely and returned from cache on subsequent calls
 * - 401 from /users/me being translated to 'Token expired' (not a generic error)
 * - clearToken() clearing both SecureStore and the in-memory cache
 */

import { AuthService } from '../../services/auth.service';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = (status: number, body: unknown, ok = status < 400) => {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok,
    status,
    statusText: 'STATUS',
    json: jest.fn().mockResolvedValueOnce(body),
  } as unknown as Response);
};

const resetInMemoryToken = () => {
  // AuthService caches token in a private static field; clear it between tests.
  (AuthService as unknown as { token: null }).token = null;
};

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetInMemoryToken();
});

describe('AuthService.login()', () => {
  it('posts credentials as application/x-www-form-urlencoded', async () => {
    mockFetch(200, { access_token: 'tok123', token_type: 'bearer' });
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

    await AuthService.login('user@test.cz', 'pass');

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/auth/login/access-token');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.body).toContain('username=user%40test.cz');
    expect(options.body).toContain('password=pass');
  });

  it('returns AuthResponse and stores token on success', async () => {
    mockFetch(200, { access_token: 'tok123', token_type: 'bearer' });
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

    const result = await AuthService.login('user@test.cz', 'pass');

    expect(result.access_token).toBe('tok123');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'tok123');
  });

  it('throws "Invalid credentials" on 401', async () => {
    mockFetch(401, { detail: 'Unauthorized' }, false);

    await expect(AuthService.login('a@b.com', 'wrong')).rejects.toThrow(
      'Invalid credentials'
    );
  });

  it('throws "Invalid login credentials" on 400', async () => {
    mockFetch(400, { detail: 'Bad credentials' }, false);

    await expect(AuthService.login('a@b.com', 'wrong')).rejects.toThrow(
      'Invalid login credentials'
    );
  });

  it('throws timeout error when fetch is aborted', async () => {
    const abortError = new Error('AbortError');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValueOnce(abortError);

    await expect(AuthService.login('a@b.com', 'pass')).rejects.toThrow(
      'Request timed out'
    );
  });
});

describe('AuthService.getCurrentUser()', () => {
  it('returns user profile when token is valid', async () => {
    // Token is in-memory already
    (AuthService as unknown as { token: string }).token = 'valid-token';

    mockFetch(200, { id: 1, email: 'a@b.com', full_name: 'Test', is_active: true, role: 'user' });

    const user = await AuthService.getCurrentUser();

    expect(user.email).toBe('a@b.com');
    expect(user.role).toBe('user');
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer valid-token');
  });

  it('clears token and throws "Token expired" on 401', async () => {
    (AuthService as unknown as { token: string }).token = 'expired-token';
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);

    mockFetch(401, { detail: 'Token expired' }, false);

    await expect(AuthService.getCurrentUser()).rejects.toThrow('Token expired');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
  });

  it('throws when no token is available', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

    await expect(AuthService.getCurrentUser()).rejects.toThrow(
      'No token available'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('AuthService.getToken()', () => {
  it('returns in-memory token without hitting SecureStore', async () => {
    (AuthService as unknown as { token: string }).token = 'cached';

    const token = await AuthService.getToken();

    expect(token).toBe('cached');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('reads from SecureStore when in-memory is null', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('stored-tok');

    const token = await AuthService.getToken();

    expect(token).toBe('stored-tok');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('auth_token');
  });

  it('returns null when neither cache nor SecureStore have a token', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

    const token = await AuthService.getToken();

    expect(token).toBeNull();
  });
});

describe('AuthService.logout()', () => {
  it('clears both SecureStore and in-memory token', async () => {
    (AuthService as unknown as { token: string }).token = 'active';
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);

    await AuthService.logout();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
    expect((AuthService as unknown as { token: null }).token).toBeNull();
  });
});

describe('AuthService.isTokenExpiredError()', () => {
  it('returns true for Error with message "Token expired"', () => {
    expect(AuthService.isTokenExpiredError(new Error('Token expired'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(AuthService.isTokenExpiredError(new Error('Network error'))).toBe(false);
    expect(AuthService.isTokenExpiredError('string error')).toBe(false);
    expect(AuthService.isTokenExpiredError(null)).toBe(false);
  });
});
