import { MeasurementBatch, Vehicle, Sensor, Session, CreateVehicleRequest, CreateSensorRequest } from '../types';
import { AuthService } from './auth.service';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api-mobile.clearway.zephyron.tech';
const API_PREFIX = '/api';

/**
 * Custom error class that includes HTTP status code
 * Used to differentiate between 4xx/5xx errors for poison pill detection
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public detail?: string
  ) {
    super(`HTTP ${statusCode}: ${detail || statusText}`);
    this.name = 'ApiError';
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  /**
   * Check if this error should mark measurements as poison pill
   * 4xx errors = client error (bad data) = poison pill
   * 5xx errors = server error (temporary) = retry later
   */
  isPoisonPill(): boolean {
    return this.isClientError();
  }
}

export class ApiService {
  /**
   * Get authorization headers with Bearer token
   */
  private static async getAuthHeaders(): Promise<HeadersInit> {
    const token = await AuthService.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }
    return {
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Get list of available vehicles from backend
   */
  static async getVehicles(): Promise<Vehicle[]> {
    try {
      console.log('🔄 Fetching vehicles from:', `${API_BASE_URL}${API_PREFIX}/vehicles`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const authHeaders = await this.getAuthHeaders();
    
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/vehicles`, {
        headers: authHeaders,
        signal: controller.signal,
      });
    
      clearTimeout(timeoutId);
      
      console.log('✓ Vehicles response status:', response.status);
    
      if (!response.ok) {
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new Error('Unauthorized - please login again');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    
      const data = await response.json();
      console.log('✓ Vehicles loaded:', data.length);
      return data;
    } catch (error) {
      console.error('Failed to fetch vehicles:', error);
      throw error;
    }
  }

  /**
   * Get list of available sensors from backend
   */
  static async getSensors(): Promise<Sensor[]> {
    try {
      console.log('🔄 Fetching sensors from:', `${API_BASE_URL}${API_PREFIX}/sensors`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const authHeaders = await this.getAuthHeaders();
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/sensors`, {
        headers: authHeaders,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      console.log('✓ Sensors response status:', response.status);
      
      if (!response.ok) {
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new Error('Unauthorized - please login again');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('✓ Sensors loaded:', data.length);
      return data;
    } catch (error) {
      console.error('Failed to fetch sensors:', error);
      throw error;
    }
  }

  /**
   * Create new measurement session
   */
  static async createSession(vehicleId: string, sensorId: string): Promise<Session> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const authHeaders = await this.getAuthHeaders();
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/sessions`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          sensor_id: sensorId,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new Error('Unauthorized - please login again');
        }
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create session');
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }

  /**
   * Send batch of measurements to backend
   * Throws ApiError with status code for proper error handling
   */
  static async sendBatch(batch: MeasurementBatch): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for batch
      
      const authHeaders = await this.getAuthHeaders();
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/measurements/raw-data/batch`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        let detail: string | undefined;
        
        try {
          const errorData = await response.json();
          detail = errorData.detail || errorData.message;
        } catch {
          // Response body is not JSON, use status text
          detail = response.statusText;
        }
        
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new ApiError(response.status, response.statusText, 'Unauthorized - please login again');
        }
        
        throw new ApiError(response.status, response.statusText, detail);
      }
      
      console.log(`✓ Batch sent: ${batch.measurements.length} measurements`);
    } catch (error) {
      // Re-throw ApiError as-is
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Wrap other errors (network, timeout, etc.)
      console.error('Failed to send batch:', error);
      throw error;
    }
  }

  /**
   * Create new vehicle (admin only)
   */
  static async createVehicle(request: CreateVehicleRequest): Promise<Vehicle> {
    try {
      console.log('🔄 Creating vehicle:', request.vehicle_name);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const authHeaders = await this.getAuthHeaders();
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/vehicles`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new Error('Unauthorized - please login again');
        }
        
        let detail: string | undefined;
        try {
          const errorData = await response.json();
          detail = errorData.detail || errorData.message;
        } catch {
          detail = response.statusText;
        }
        
        throw new ApiError(response.status, response.statusText, detail);
      }
      
      const data = await response.json();
      console.log('✓ Vehicle created:', data.id);
      return data;
    } catch (error) {
      console.error('Failed to create vehicle:', error);
      throw error;
    }
  }

  /**
   * Create new sensor (admin only)
   */
  static async createSensor(request: CreateSensorRequest): Promise<Sensor> {
    try {
      console.log('🔄 Creating sensor:', request.description);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const authHeaders = await this.getAuthHeaders();
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/sensors`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 401) {
          await AuthService.clearToken();
          throw new Error('Unauthorized - please login again');
        }
        
        let detail: string | undefined;
        try {
          const errorData = await response.json();
          detail = errorData.detail || errorData.message;
        } catch {
          detail = response.statusText;
        }
        
        throw new ApiError(response.status, response.statusText, detail);
      }
      
      const data = await response.json();
      console.log('✓ Sensor created:', data.id);
      return data;
    } catch (error) {
      console.error('Failed to create sensor:', error);
      throw error;
    }
  }
}
