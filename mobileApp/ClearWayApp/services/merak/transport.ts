/**
 * Native BLE transport (Android/iOS) on react-native-ble-plx.
 *
 * Needs a development build or an EAS build - the native module is not part of Expo Go.
 * On the web Metro uses transport.web.ts instead.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { MerakConfig } from '../../config/merak.config';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { CreateTransport, MerakTransport, TransportHandlers, TransportInfo } from './transport.types';

async function ensureAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const perms =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(perms);
  const denied = perms.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new Error('Chybí oprávnění k Bluetooth. Povolte ho v nastavení aplikace.');
  }
}

function waitForPoweredOn(manager: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth je vypnutý. Zapněte ho a zkuste to znovu.'));
    }, 4000);
    const sub = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

function scanForDevice(manager: BleManager): Promise<Device> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stopDeviceScan();
      reject(
        new Error(
          'Měřák nenalezen. Zkontrolujte napájení; zařízení přijímá jen jedno spojení, takže musí být odpojené od PC nebo Raspberry Pi.'
        )
      );
    }, MerakConfig.SCAN_TIMEOUT_MS);

    manager.startDeviceScan([MerakConfig.SERVICE_UUID], null, (error, device) => {
      if (error) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        reject(new Error(error.message));
        return;
      }
      if (device) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        resolve(device);
      }
    });
  });
}

class NativeTransport implements MerakTransport {
  private manager: BleManager | null = null;
  private device: Device | null = null;
  private subscriptions: Subscription[] = [];

  isSupported(): boolean {
    return true;
  }

  async connect({ onData, onDisconnect }: TransportHandlers): Promise<TransportInfo> {
    await ensureAndroidPermissions();
    // Created lazily: constructing BleManager touches the native module.
    if (!this.manager) this.manager = new BleManager();
    const manager = this.manager;
    await waitForPoweredOn(manager);

    const found = await scanForDevice(manager);
    // Spec 4.3: the 25 B raw frame needs MTU >= 28, ask for the maximum the device accepts (247).
    const device = await found.connect({
      requestMTU: MerakConfig.REQUEST_MTU,
      timeout: MerakConfig.CONNECT_TIMEOUT_MS,
    });
    await device.discoverAllServicesAndCharacteristics();

    this.device = device;
    let reported = false;
    const reportOnce = (reason?: string) => {
      if (reported) return;
      reported = true;
      onDisconnect(reason);
    };
    this.subscriptions.push(device.onDisconnected((error) => reportOnce(error?.message)));
    this.subscriptions.push(
      device.monitorCharacteristicForService(MerakConfig.SERVICE_UUID, MerakConfig.DATA_UUID, (error, characteristic) => {
        if (error) {
          reportOnce(error.message);
          return;
        }
        if (characteristic?.value) onData(base64ToBytes(characteristic.value));
      })
    );

    return { name: device.name ?? device.localName ?? MerakConfig.DEVICE_NAME, mtu: device.mtu };
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('Měřák není připojený');
    await this.device.writeCharacteristicWithResponseForService(
      MerakConfig.SERVICE_UUID,
      MerakConfig.MSG_UUID,
      bytesToBase64(data)
    );
  }

  async disconnect(): Promise<void> {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    const device = this.device;
    this.device = null;
    if (device) {
      try {
        await device.cancelConnection();
      } catch {
        // already disconnected
      }
    }
  }
}

export const createTransport: CreateTransport = () => new NativeTransport();
