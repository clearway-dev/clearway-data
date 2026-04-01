import * as SecureStore from 'expo-secure-store';
import { User, LoginRequest, AuthResponse } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api-mobile.clearway.zephyron.tech';
const API_PREFIX = '/api';
const TOKEN_KEY = 'auth_token';

export class AuthService {
  private static token: string | null = null;

  /**
   * Login with email and password
   * Sends credentials as application/x-www-form-urlencoded
   */
  static async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/auth/login/access-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = 'Přihlášení selhalo';
        
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } catch {
          // Response is not JSON
        }

        if (response.status === 401) {
          throw new Error('Neplatné přihlašovací údaje');
        } else if (response.status === 400) {
          throw new Error('Chybné přihlašovací údaje');
        }

        throw new Error(errorMessage);
      }

      const data: AuthResponse = await response.json();
      
      // Store token
      await this.setToken(data.access_token);
      
      console.log('✓ Login successful');
      return data;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Časový limit požadavku vypršel');
        }
        throw error;
      }
      throw new Error('Přihlášení selhalo');
    }
  }

  /**
   * Get current user profile
   */
  static async getCurrentUser(): Promise<User> {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error('No token available');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/auth/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          // Token is invalid or expired
          await this.clearToken();
          throw new Error('Token expired');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const user: User = await response.json();
      console.log('✓ User profile loaded:', user.email);
      return user;
    } catch (error) {
      console.error('Failed to fetch current user:', error);
      throw error;
    }
  }

  /**
   * Logout - clear token from storage
   */
  static async logout(): Promise<void> {
    await this.clearToken();
    console.log('✓ Logged out');
  }

  /**
   * Get stored token
   */
  static async getToken(): Promise<string | null> {
    if (this.token) {
      return this.token;
    }

    try {
      this.token = await SecureStore.getItemAsync(TOKEN_KEY);
      return this.token;
    } catch (error) {
      console.error('Failed to get token from SecureStore:', error);
      return null;
    }
  }

  /**
   * Store token securely
   */
  static async setToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      this.token = token;
      console.log('✓ Token stored securely');
    } catch (error) {
      console.error('Failed to store token in SecureStore:', error);
      throw error;
    }
  }

  /**
   * Clear stored token
   */
  static async clearToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      this.token = null;
      console.log('✓ Token cleared');
    } catch (error) {
      console.error('Failed to clear token from SecureStore:', error);
    }
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
