/**
 * One-line text form of a data frame for the console on the service screen. Mirrors the console
 * output of ClearWay-FW/client/meas_client.py, so the two can be compared side by side.
 *
 *   MIN  master 426 cm (J4) · slave 418 cm (S3) · t=1234 ms
 *   RAW  master 423 cm (J1) · slave 417 cm (S3) · t=0 ms
 *        J1=[423] J2=425 J3=PORUCHA J4=423 | S1=424 S2=429 S3=[417] S4=425
 */
import type { MerakFrame, SensorState, UnitReading } from './protocol';

const STATE_SHORT: Record<SensorState, string> = {
  ok: '',
  tooClose: 'BLÍZKO',
  noTarget: '--',
  fault: 'PORUCHA',
};

export function unitText(unit: UnitReading, prefix: 'J' | 'S'): string {
  const sensor = unit.index !== null ? ` (${prefix}${unit.index + 1})` : '';
  switch (unit.state) {
    case 'ok':
      return `${unit.min} cm${sensor}`;
    case 'tooClose':
      return `PŘÍLIŠ BLÍZKO${sensor}`;
    case 'noTarget':
      return 'nic v dosahu';
    case 'fault':
      return 'PORUCHA';
  }
}

function cells(values: (number | null)[], states: SensorState[], prefix: 'J' | 'S', unit: UnitReading): string {
  return values
    .map((v, i) => {
      const st = states[i];
      let txt: string;
      if (st === 'ok' && v !== null) txt = unit.state === 'ok' && unit.index === i ? `[${v}]` : String(v);
      else txt = STATE_SHORT[st] || '--';
      return `${prefix}${i + 1}=${txt}`;
    })
    .join(' ');
}

export function formatFrame(f: MerakFrame): string {
  const head =
    `${f.mode.toUpperCase()}  master ${unitText(f.masterUnit, 'J')} · slave ${unitText(f.slaveUnit, 'S')}` +
    `${f.slaveConnected ? '' : ' (slave nepřipojen)'} · t=${f.timeMs} ms`;
  if (f.mode !== 'raw' || !f.masterStates || !f.slaveStates) return head;
  return `${head}\n     ${cells(f.master, f.masterStates, 'J', f.masterUnit)} | ${cells(f.slave, f.slaveStates, 'S', f.slaveUnit)}`;
}

/** True when the frame carries something the user must not miss (always shown, like the reference client). */
export const isAlarm = (f: MerakFrame): boolean =>
  f.masterUnit.state === 'tooClose' || f.slaveUnit.state === 'tooClose';
