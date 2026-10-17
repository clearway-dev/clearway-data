/**
 * Turns whatever the login flow throws into a message a user can act on.
 *
 * AuthService throws English messages and the browser/runtime throws raw TypeErrors
 * ("Failed to fetch"); neither tells the user whether the password is wrong or the server is
 * simply not reachable. Messages that are already readable (e.g. Czech ones) pass through.
 */

const NETWORK_ERROR = /failed to fetch|network request failed|load failed|networkerror|network error/i;

export function friendlyLoginError(error: unknown, apiUrl: string): string {
  if (!(error instanceof Error)) return 'Přihlášení selhalo';

  const message = error.message;

  if (message === 'Invalid credentials' || message === 'Invalid login credentials') {
    return 'Nesprávný e-mail nebo heslo.';
  }
  if (message === 'Request timed out' || error.name === 'AbortError') {
    return `Server neodpovídá (${apiUrl}). Zkuste to za chvíli.`;
  }
  if (NETWORK_ERROR.test(message)) {
    return `Server ${apiUrl} není dostupný. Zkontrolujte připojení a adresu serveru.`;
  }
  // Raised by AuthService.getCurrentUser() as "HTTP 500: Internal Server Error".
  const http = /^HTTP (\d{3})/.exec(message);
  if (http) {
    return `Server vrátil chybu ${http[1]}. Zkuste to znovu, případně kontaktujte správce.`;
  }
  if (message === 'Login failed') {
    return 'Server vrátil neočekávanou odpověď. Zkuste to znovu.';
  }
  return message || 'Přihlášení selhalo';
}
