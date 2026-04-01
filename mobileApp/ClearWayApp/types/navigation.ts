export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Setup: undefined;
  Measurement: {
    sessionId: string;
    vehicleId: string;
    sensorId: string;
  };
  SyncErrors: undefined;
};

// Re-export types from index.ts for convenience
export type { Vehicle, Sensor, Session, SyncStatus } from './index';
