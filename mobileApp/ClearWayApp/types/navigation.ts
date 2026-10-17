import type { MeasurementSource } from '../services/merak/sensor-records';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Setup: undefined;
  Measurement: {
    sessionId: string;
    vehicleId: string;
    sensorId: string;
    /** Chosen on the START screen; missing = test data (simulation). */
    dataSource?: MeasurementSource;
  };
  SyncErrors: undefined;
  Admin: undefined;
  MerakSetup: undefined;
  MerakService: undefined;
};

// Re-export types from index.ts for convenience
export type { Vehicle, Sensor, Session, SyncStatus } from './index';
