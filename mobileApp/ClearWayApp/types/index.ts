export interface Vehicle {
  id: string;
  vehicle_name: string;
  width: number;
}

export interface Sensor {
  id: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  sensor_id: string;
  vehicle_id: string;
}

export interface LocalMeasurement {
  id: number;
  session_id: string;
  measured_at: string;
  latitude: number;
  longitude: number;
  distance_left: number;
  distance_right: number;
  speed: number | null; // Může být null pokud GPS neposkytuje rychlost
  accuracy_gps: number | null; // Může být null pokud GPS neposkytuje přesnost
  synced: number; // 0 = pending, 1 = synced successfully, -1 = error (poison pill)
  error_message: string | null; // Error message if synced = -1
  error_at: string | null; // ISO timestamp when error occurred
}

export interface MeasurementItem {
  measured_at: string;
  latitude: number;
  longitude: number;
  distance_left: number;
  distance_right: number;
  speed: number | null; // Může být null pokud GPS neposkytuje rychlost
  accuracy_gps: number | null; // Může být null pokud GPS neposkytuje přesnost
}

export interface MeasurementBatch {
  session_id: string;
  measurements: MeasurementItem[];
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'success' | 'error';
  message?: string;
  timestamp?: number;
}

// Authentication types
export interface User {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  role: string;
}

export interface LoginRequest {
  username: string; // email
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Admin types
export interface CreateVehicleRequest {
  vehicle_name: string;
  width: number;
}

export interface CreateSensorRequest {
  description: string;
  is_active: boolean;
}

