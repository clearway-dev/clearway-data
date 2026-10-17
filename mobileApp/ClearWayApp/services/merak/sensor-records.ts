/**
 * Which backend sensor record a measurement belongs to.
 *
 * A session on the backend needs the id of a row in `sensors`. The app offers two data sources on
 * the START screen - the connected measuring unit, or the built-in test generator - and each of them
 * gets its own sensor record. That keeps simulated and real data apart in the database (the schema is
 * unchanged; only rows are added, through the normal API).
 *
 * Records are recognised by their description:
 *   test generator   "Testovací měřák – náhodná data (aplikace ClearWay)"
 *   measuring unit   "Měřák ESP32bt_MeasLength SN 3485184546E5"   (SN from the reply to V)
 */
import { ApiService } from '../api.service';
import type { Sensor } from '../../types';

/** Where the distances of a measurement come from. */
export type MeasurementSource = 'merak' | 'simulation';

export const TEST_SENSOR_DESCRIPTION = 'Testovací měřák – náhodná data (aplikace ClearWay)';

export function merakSensorDescription(deviceName: string | null, serial: string | null): string {
  return `Měřák ${deviceName || 'ESP32bt_MeasLength'}${serial ? ` SN ${serial}` : ''}`;
}

export function findTestSensor(sensors: Sensor[]): Sensor | undefined {
  return sensors.find((s) => s.description === TEST_SENSOR_DESCRIPTION);
}

/** The record of this unit: matched by serial number when it is known, otherwise by the full description. */
export function findMerakSensor(sensors: Sensor[], deviceName: string | null, serial: string | null): Sensor | undefined {
  if (serial) return sensors.find((s) => (s.description ?? '').includes(`SN ${serial}`));
  return sensors.find((s) => s.description === merakSensorDescription(deviceName, null));
}

/** Thrown when the record is missing and the user may not create it (POST /sensors is admin only). */
export class MissingSensorError extends Error {
  constructor(public description: string) {
    super(`Na serveru chybí senzor „${description}“. Založit ho může jen administrátor.`);
    this.name = 'MissingSensorError';
  }
}

/** Existing record, or a new one created through the API (admins only). */
export async function ensureSensor(sensors: Sensor[], description: string, isAdmin: boolean): Promise<Sensor> {
  const existing = sensors.find((s) => s.description === description);
  if (existing) return existing;
  if (!isAdmin) throw new MissingSensorError(description);
  return ApiService.createSensor({ description, is_active: true });
}
