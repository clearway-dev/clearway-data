/**
 * Web Bluetooth transport for testing in Chrome/Edge (desktop or Android).
 *
 * requestDevice() must be triggered by a user gesture, which the "Připojit měřák" button is.
 * The browser shows its own device picker. Web Bluetooth works only on HTTPS or localhost and
 * does not expose the MTU - the OS negotiates it.
 */
import { MerakConfig } from '../../config/merak.config';
import type { CreateTransport, MerakTransport, TransportHandlers, TransportInfo } from './transport.types';

// Web Bluetooth has no types in the default DOM lib of this TypeScript version.
/* eslint-disable @typescript-eslint/no-explicit-any */
const bluetooth = (): any => (typeof navigator !== 'undefined' ? (navigator as any).bluetooth : undefined);

class WebTransport implements MerakTransport {
  private device: any = null;
  private msg: any = null;
  private data: any = null;
  private onValue: ((e: any) => void) | null = null;
  private onGattDisconnect: (() => void) | null = null;

  isSupported(): boolean {
    return !!bluetooth();
  }

  async connect({ onData, onDisconnect }: TransportHandlers): Promise<TransportInfo> {
    const bt = bluetooth();
    if (!bt) {
      throw new Error('Tento prohlížeč nepodporuje Web Bluetooth. Použijte Chrome nebo Edge.');
    }

    const device = await bt.requestDevice({
      filters: [{ services: [MerakConfig.SERVICE_UUID] }, { namePrefix: MerakConfig.NAME_PREFIX }],
      optionalServices: [MerakConfig.SERVICE_UUID],
    });
    this.device = device;

    let reported = false;
    this.onGattDisconnect = () => {
      if (reported) return;
      reported = true;
      onDisconnect();
    };
    device.addEventListener('gattserverdisconnected', this.onGattDisconnect);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MerakConfig.SERVICE_UUID);
    this.msg = await service.getCharacteristic(MerakConfig.MSG_UUID);
    this.data = await service.getCharacteristic(MerakConfig.DATA_UUID);

    this.onValue = (event: any) => {
      const view: DataView = event.target.value;
      // Copy: the browser may reuse the underlying buffer.
      onData(new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)));
    };
    this.data.addEventListener('characteristicvaluechanged', this.onValue);
    await this.data.startNotifications();

    return { name: device.name || MerakConfig.DEVICE_NAME };
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.msg) throw new Error('Měřák není připojený');
    if (typeof this.msg.writeValueWithResponse === 'function') {
      await this.msg.writeValueWithResponse(bytes);
    } else {
      await this.msg.writeValue(bytes);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.data && this.onValue) this.data.removeEventListener('characteristicvaluechanged', this.onValue);
      if (this.device && this.onGattDisconnect) {
        this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnect);
      }
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.device = null;
      this.msg = null;
      this.data = null;
      this.onValue = null;
      this.onGattDisconnect = null;
    }
  }
}

export const createTransport: CreateTransport = () => new WebTransport();
