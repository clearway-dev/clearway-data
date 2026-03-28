import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  Setup: undefined;
  Measurement: {
    sessionId: string;
    vehicleId: string;
    sensorId: string;
  };
};

// Re-export types from index.ts for convenience
export type { Vehicle, Sensor, Session, SyncStatus } from './index';
