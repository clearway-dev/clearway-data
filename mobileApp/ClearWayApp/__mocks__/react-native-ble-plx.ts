/**
 * Jest stub for react-native-ble-plx. The native module does not exist in the test runtime;
 * the BLE logic is tested through an injected fake transport (see __tests__/contexts/BleContext).
 */
export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
} as const;

export class BleManager {
  onStateChange = jest.fn();
  startDeviceScan = jest.fn();
  stopDeviceScan = jest.fn();
  destroy = jest.fn();
}

export type Device = unknown;
export type Subscription = { remove: () => void };
