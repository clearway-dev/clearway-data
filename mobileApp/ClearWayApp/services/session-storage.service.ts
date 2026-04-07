import AsyncStorage from '@react-native-async-storage/async-storage';

interface SessionState {
  sessionId: string;
  vehicleId: string;
  sensorId: string;
  timestamp: number; // When the session was created
}

const SESSION_STORAGE_KEY = '@clearway/last_session';

/**
 * Service for persisting and retrieving the last used session configuration
 */
export class SessionStorageService {
  /**
   * Save the current session state to AsyncStorage
   */
  static async saveSession(sessionId: string, vehicleId: string, sensorId: string): Promise<void> {
    try {
      const sessionState: SessionState = {
        sessionId,
        vehicleId,
        sensorId,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionState));
      console.log('✓ Session state saved to storage:', sessionId);
    } catch (error) {
      console.error('Failed to save session state:', error);
    }
  }

  /**
   * Load the last used session state from AsyncStorage
   */
  static async loadSession(): Promise<SessionState | null> {
    try {
      const stored = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      if (!stored) {
        return null;
      }
      const sessionState: SessionState = JSON.parse(stored);
      console.log('✓ Session state loaded from storage:', sessionState.sessionId);
      return sessionState;
    } catch (error) {
      console.error('Failed to load session state:', error);
      return null;
    }
  }

  /**
   * Clear the stored session state
   */
  static async clearSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
      console.log('✓ Session state cleared from storage');
    } catch (error) {
      console.error('Failed to clear session state:', error);
    }
  }
}
