/**
 * Platform independent BLE transport used by BleContext.
 *
 * `transport.ts` is the native implementation (react-native-ble-plx, Android/iOS dev build),
 * `transport.web.ts` uses Web Bluetooth (Chrome/Edge). Metro picks the right file by platform.
 */

export interface TransportHandlers {
  /** One DATA notification (a complete frame, never fragmented). */
  onData: (bytes: Uint8Array) => void;
  /** Called once when the link goes down for any reason. */
  onDisconnect: (reason?: string) => void;
}

export interface TransportInfo {
  name: string;
  /** Negotiated MTU when the platform exposes it (Web Bluetooth does not). */
  mtu?: number;
}

export interface MerakTransport {
  /** false e.g. in a browser without Web Bluetooth. */
  isSupported(): boolean;
  /** Ask for / scan the device, connect and subscribe to DATA notifications. */
  connect(handlers: TransportHandlers): Promise<TransportInfo>;
  /** Write ASCII command to the MSG characteristic (with response). */
  write(data: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

export type CreateTransport = () => MerakTransport;
