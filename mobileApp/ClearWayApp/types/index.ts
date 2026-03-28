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
  speed: number;
  accuracy_gps: number;
  synced: number; // 0 or 1 (SQLite boolean)
}

export interface MeasurementItem {
  measured_at: string;
  latitude: number;
  longitude: number;
  distance_left: number;
  distance_right: number;
  speed: number;
  accuracy_gps: number;
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

