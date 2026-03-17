import { MeasurementBatch, Vehicle, Sensor, Session } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api-mobile.clearway.zephyron.tech';
const API_PREFIX = '/api';

export class ApiService {
  /**
   * Get list of available vehicles from backend
   */
  static async getVehicles(): Promise<Vehicle[]> {
    try {
      console.log('🔄 Fetching vehicles from:', `${API_BASE_URL}${API_PREFIX}/vehicles`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/vehicles`, {
        signal: controller.signal,
      });
    
      clearTimeout(timeoutId);
      
      console.log('✓ Vehicles response status:', response.status);
    
      if (!response.ok) {
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
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/sensors`, {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      console.log('✓ Sensors response status:', response.status);
      
      if (!response.ok) {
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
      
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}/sessions`, {
        method: 'POST',
        headers: {
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
   */
  static async sendBatch(batch: MeasurementBatch): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for batch
      
      const response = await fetch(`${API_BASE_URL}/raw-data/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to send batch');
      }
      
      console.log(`✓ Batch sent: ${batch.measurements.length} measurements`);
    } catch (error) {
      console.error('Failed to send batch:', error);
      throw error;
    }
  }
}
