/**
 * Helpers behind a reliable login: readable error messages and a working Alert on the web.
 */
import { Alert, Platform } from 'react-native';
import { friendlyLoginError } from '../../services/auth-errors';
import { installWebAlert, webAlert } from '../../services/web-alert';

const URL = 'http://localhost:8000';

describe('friendlyLoginError', () => {
  it('translates the two "invalid credentials" messages of AuthService', () => {
    expect(friendlyLoginError(new Error('Invalid credentials'), URL)).toBe('Nesprávný e-mail nebo heslo.');
    expect(friendlyLoginError(new Error('Invalid login credentials'), URL)).toBe('Nesprávný e-mail nebo heslo.');
  });

  it.each(['Failed to fetch', 'Network request failed', 'Load failed', 'NetworkError when attempting to fetch resource.'])(
    'turns the network error "%s" into "server not available" with the address',
    (raw) => {
      const msg = friendlyLoginError(new TypeError(raw), URL);
      expect(msg).toContain(URL);
      expect(msg).toContain('není dostupný');
      expect(msg).not.toContain(raw);
    }
  );

  it('explains a timeout', () => {
    expect(friendlyLoginError(new Error('Request timed out'), URL)).toContain('Server neodpovídá');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(friendlyLoginError(abort, URL)).toContain('Server neodpovídá');
  });

  it('turns an HTTP error from the profile request into a server error with the status code', () => {
    expect(friendlyLoginError(new Error('HTTP 500: Internal Server Error'), URL)).toContain('chybu 500');
    expect(friendlyLoginError(new Error('HTTP 503: Service Unavailable'), URL)).toContain('chybu 503');
  });

  it('explains the generic AuthService failure', () => {
    expect(friendlyLoginError(new Error('Login failed'), URL)).toContain('neočekávanou odpověď');
  });

  it('keeps a readable message untouched (e.g. a backend detail in Czech)', () => {
    expect(friendlyLoginError(new Error('Neplatné přihlašovací údaje'), URL)).toBe('Neplatné přihlašovací údaje');
  });

  it('falls back for anything that is not an Error', () => {
    expect(friendlyLoginError('boom', URL)).toBe('Přihlášení selhalo');
    expect(friendlyLoginError(undefined, URL)).toBe('Přihlášení selhalo');
  });

  it('falls back for an Error without a message', () => {
    expect(friendlyLoginError(new Error(''), URL)).toBe('Přihlášení selhalo');
  });
});

describe('webAlert', () => {
  const g = globalThis as unknown as { alert?: jest.Mock; confirm?: jest.Mock };
  let originalAlert: unknown;
  let originalConfirm: unknown;

  beforeEach(() => {
    originalAlert = g.alert;
    originalConfirm = g.confirm;
    g.alert = jest.fn();
    g.confirm = jest.fn();
  });

  afterEach(() => {
    (g as Record<string, unknown>).alert = originalAlert;
    (g as Record<string, unknown>).confirm = originalConfirm;
  });

  it('shows a simple message with window.alert, title and text together', () => {
    webAlert('Chyba', 'Něco se nepovedlo');
    expect(g.alert).toHaveBeenCalledWith('Chyba\n\nNěco se nepovedlo');
  });

  it('shows just the title when there is no message', () => {
    webAlert('Hotovo');
    expect(g.alert).toHaveBeenCalledWith('Hotovo');
  });

  it('reports the press of a single OK button', () => {
    const onPress = jest.fn();
    webAlert('Info', 'text', [{ text: 'OK', onPress }]);
    expect(g.alert).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('runs the affirmative button when the confirmation is accepted', () => {
    g.confirm!.mockReturnValue(true);
    const cancel = jest.fn();
    const ok = jest.fn();
    webAlert('Odhlásit se', 'Opravdu?', [
      { text: 'Zrušit', style: 'cancel', onPress: cancel },
      { text: 'Odhlásit', style: 'destructive', onPress: ok },
    ]);
    expect(g.confirm).toHaveBeenCalledWith('Odhlásit se\n\nOpravdu?');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('runs the cancel button when the confirmation is declined', () => {
    g.confirm!.mockReturnValue(false);
    const cancel = jest.fn();
    const ok = jest.fn();
    webAlert('Odhlásit se', 'Opravdu?', [
      { text: 'Zrušit', style: 'cancel', onPress: cancel },
      { text: 'Odhlásit', onPress: ok },
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ok).not.toHaveBeenCalled();
  });

  it('finds the affirmative button even when it is listed first', () => {
    g.confirm!.mockReturnValue(true);
    const ok = jest.fn();
    webAlert('T', 'm', [
      { text: 'Smazat', onPress: ok },
      { text: 'Zrušit', style: 'cancel' },
    ]);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('does not fail when a declined confirmation has no cancel button', () => {
    g.confirm!.mockReturnValue(false);
    expect(() => webAlert('T', 'm', [{ text: 'A' }, { text: 'B' }])).not.toThrow();
  });
});

describe('installWebAlert', () => {
  it('replaces Alert.alert on the web only', () => {
    const original = Alert.alert;
    const web = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      installWebAlert();
      expect(Alert.alert).toBe(webAlert);
    } finally {
      web.restore();
      Alert.alert = original;
    }
  });

  it('leaves Alert.alert alone on a device', () => {
    const original = Alert.alert;
    installWebAlert(); // Platform.OS is "ios" in Jest
    expect(Alert.alert).toBe(original);
  });
});
