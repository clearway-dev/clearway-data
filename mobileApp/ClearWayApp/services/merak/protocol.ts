/**
 * Measuring unit ("měřák") wire protocol - pure functions, no BLE and no React.
 *
 * Source of truth: ClearWay-FW/specifikace-zarizeni.md (section 3.3, 4) and src/measure.cpp
 * (buildRaw / buildMin / unitMin). Every notification on the DATA characteristic starts with a type byte:
 *   0x2A (star)  heartbeat (1 B, every 1 s)
 *   0xAA         data frame
 *                  protocol 2 (FW 4.0.0+): raw 27 B (byte 1 = 0x21), min 14 B (0x22), with sensor states
 *                  protocol 1 (FW <= 3.6):  raw 25 B (0x11),        min 13 B (0x12), validity bits only
 *   0xBB         machine reply to a command (5 B)
 *   0x3E (>)     human readable text reply
 *
 * All multi-byte values are big endian. An invalid distance is 0xFFFF *and* a cleared validity bit;
 * the reason is in the sensor state (protocol 2). Since protocol 2 every value is a peak-hold over the
 * interval since the previous frame: the shortest valid distance and the worst state.
 */

export type MerakMode = 'min' | 'raw';

/**
 * State of one sensor or one unit (protocol 2, 2 bits, spec 3.3):
 *   ok       0  valid distance
 *   tooClose 1  obstacle inside the dead zone (TF-Luna < 20 cm) or saturation
 *   noTarget 2  nothing in range (weak reflection, 0, beyond the maximum range)
 *   fault    3  no frame from the sensor for more than 100 ms (disconnected, broken)
 */
export type SensorState = 'ok' | 'tooClose' | 'noTarget' | 'fault';

export const SENSOR_STATES: readonly SensorState[] = ['ok', 'tooClose', 'noTarget', 'fault'];

export const SENSORS_PER_UNIT = 4;
export const INVALID_DISTANCE = 0xffff;
export const NO_SLAVE_AGE = 0xff;

const TYPE_HEARTBEAT = 0x2a;
const TYPE_FRAME = 0xaa;
const TYPE_REPLY = 0xbb;
const TYPE_TEXT = 0x3e;

/** Summary of one unit (master or slave), computed exactly like unitMin() in the firmware. */
export interface UnitReading {
  /** tooClose (any sensor) > ok (minimum of OK sensors) > noTarget (any sensor) > fault */
  state: SensorState;
  /** Shortest valid distance in cm; only when state is 'ok'. */
  min: number | null;
  /** Sensor (0-3) with the minimum, or the one reporting 'tooClose'; null when unknown. */
  index: number | null;
}

export interface MerakFrame {
  /** Protocol version from the upper nibble of byte 1. */
  protocol: number;
  mode: MerakMode;
  slaveConnected: boolean;
  measuringRunning: boolean;
  /** Raw mode: 4 master distances in cm, null = invalid. Min mode: all null. */
  master: (number | null)[];
  slave: (number | null)[];
  /** Raw mode: state of each sensor. Protocol 1 has no states: valid = ok, invalid = fault. Min mode: null. */
  masterStates: SensorState[] | null;
  slaveStates: SensorState[] | null;
  /** State and minimum of each unit, in both modes. */
  masterUnit: UnitReading;
  slaveUnit: UnitReading;
  /** Shortest valid distance of the unit in cm (= unit.min). */
  masterMin: number | null;
  slaveMin: number | null;
  /** Sensor that gave the minimum or reports 'tooClose' (= unit.index). */
  masterMinIndex: number | null;
  slaveMinIndex: number | null;
  /** Milliseconds since the last start of measurement (command M). */
  timeMs: number;
  /** Age of the slave data in ms, null = unknown / slave unavailable (0xFF). */
  slaveAgeMs: number | null;
  /** Length of the notification in bytes. */
  length: number;
}

export type MerakMessage =
  | { type: 'heartbeat' }
  | { type: 'frame'; frame: MerakFrame }
  | { type: 'reply'; command: string; status: number; value: number }
  | { type: 'text'; text: string }
  /** A 0xAA frame with a protocol version this app has no parser for. */
  | { type: 'unsupported'; protocol: number; length: number }
  | { type: 'unknown'; reason: string };

export const REPLY_STATUS_LABEL: Record<number, string> = {
  0: 'OK',
  1: 'hodnota mimo rozsah',
  2: 'neznámý příkaz',
  3: 'nelze provést',
  4: 'interní chyba zařízení',
};

export const replyStatusLabel = (status: number): string =>
  REPLY_STATUS_LABEL[status] ?? `neznámý stav ${status}`;

const u16 = (b: Uint8Array, offset: number): number => (b[offset] << 8) | b[offset + 1];
const u32 = (b: Uint8Array, offset: number): number =>
  ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;

const validDistance = (value: number, validBit: boolean): number | null =>
  validBit && value !== INVALID_DISTANCE ? value : null;

const slaveAgeMs = (raw: number): number | null => (raw === NO_SLAVE_AGE ? null : raw * 10);

/** 4 states packed 2 bits per sensor, sensor i on bits 2i..2i+1 (spec 4.5, bytes 25 and 26). */
export const unpackStates = (byte: number): SensorState[] =>
  [0, 1, 2, 3].map((i) => SENSOR_STATES[(byte >> (2 * i)) & 0x03]);

/** Unit state from its sensors, the firmware rule (measure.cpp unitMin). */
export function unitReading(states: SensorState[], values: (number | null)[]): UnitReading {
  const close = states.indexOf('tooClose');
  if (close >= 0) return { state: 'tooClose', min: null, index: close };
  let min: number | null = null;
  let index: number | null = null;
  states.forEach((s, i) => {
    const v = values[i];
    if (s === 'ok' && v !== null && (min === null || v < min)) {
      min = v;
      index = i;
    }
  });
  if (min !== null) return { state: 'ok', min, index };
  if (states.includes('noTarget')) return { state: 'noTarget', min: null, index: null };
  return { state: 'fault', min: null, index: null };
}

/** Protocol 1 knows only valid / invalid; the reference client treats invalid as a fault. */
const v1States = (values: (number | null)[]): SensorState[] => values.map((v) => (v === null ? 'fault' : 'ok'));

const frameOf = (
  b: Uint8Array,
  protocol: number,
  mode: MerakMode,
  fields: {
    master: (number | null)[];
    slave: (number | null)[];
    masterStates: SensorState[] | null;
    slaveStates: SensorState[] | null;
    masterUnit: UnitReading;
    slaveUnit: UnitReading;
    timeMs: number;
    ageByte: number;
  }
): MerakFrame => ({
  protocol,
  mode,
  slaveConnected: (b[3] & 0x01) !== 0,
  measuringRunning: (b[3] & 0x02) !== 0,
  master: fields.master,
  slave: fields.slave,
  masterStates: fields.masterStates,
  slaveStates: fields.slaveStates,
  masterUnit: fields.masterUnit,
  slaveUnit: fields.slaveUnit,
  masterMin: fields.masterUnit.min,
  slaveMin: fields.slaveUnit.min,
  masterMinIndex: fields.masterUnit.index,
  slaveMinIndex: fields.slaveUnit.index,
  timeMs: fields.timeMs,
  slaveAgeMs: slaveAgeMs(fields.ageByte),
  length: b.length,
});

const rawValues = (b: Uint8Array): { master: (number | null)[]; slave: (number | null)[] } => {
  const bitmap = b[2];
  const values: (number | null)[] = [];
  for (let i = 0; i < 2 * SENSORS_PER_UNIT; i++) {
    values.push(validDistance(u16(b, 4 + 2 * i), ((bitmap >> i) & 1) === 1));
  }
  return { master: values.slice(0, SENSORS_PER_UNIT), slave: values.slice(SENSORS_PER_UNIT) };
};

/** Raw frame: protocol 1 = 25 B (spec 4.5 before FW 4.0.0), protocol 2 = 27 B (+ states in bytes 25, 26). */
const parseRaw = (b: Uint8Array, protocol: number): MerakFrame | null => {
  const needed = protocol >= 2 ? 27 : 25;
  if (b.length < needed) return null;
  const { master, slave } = rawValues(b);
  let masterStates = protocol >= 2 ? unpackStates(b[25]) : v1States(master);
  let slaveStates = protocol >= 2 ? unpackStates(b[26]) : v1States(slave);
  // The bitmap decides whether a value is usable. A sensor whose state says ok but whose validity bit
  // is cleared (never sent by the firmware) is treated as a fault rather than as a distance.
  masterStates = masterStates.map((s, i) => (s === 'ok' && master[i] === null ? 'fault' : s));
  slaveStates = slaveStates.map((s, i) => (s === 'ok' && slave[i] === null ? 'fault' : s));
  return frameOf(b, protocol, 'raw', {
    master,
    slave,
    masterStates,
    slaveStates,
    masterUnit: unitReading(masterStates, master),
    slaveUnit: unitReading(slaveStates, slave),
    timeMs: u32(b, 20),
    ageByte: b[24],
  });
};

/** Min frame: protocol 1 = 13 B (spec 4.6 before FW 4.0.0), protocol 2 = 14 B (+ unit states in byte 13). */
const parseMin = (b: Uint8Array, protocol: number): MerakFrame | null => {
  const needed = protocol >= 2 ? 14 : 13;
  if (b.length < needed) return null;
  const flags = b[2];
  const masterMin = validDistance(u16(b, 4), (flags & 0x01) !== 0);
  const slaveMin = validDistance(u16(b, 6), (flags & 0x02) !== 0);
  const masterIdx = (flags >> 2) & 0x03;
  const slaveIdx = (flags >> 4) & 0x03;

  let masterState: SensorState;
  let slaveState: SensorState;
  if (protocol >= 2) {
    masterState = SENSOR_STATES[b[13] & 0x03];
    slaveState = SENSOR_STATES[(b[13] >> 2) & 0x03];
  } else {
    masterState = masterMin === null ? 'fault' : 'ok';
    slaveState = slaveMin === null ? 'fault' : 'ok';
  }
  // A unit is only 'ok' with a usable value (bitmap rules); the index is meaningful for ok and tooClose.
  if (masterState === 'ok' && masterMin === null) masterState = 'fault';
  if (slaveState === 'ok' && slaveMin === null) slaveState = 'fault';
  const unit = (state: SensorState, min: number | null, idx: number): UnitReading => ({
    state,
    min: state === 'ok' ? min : null,
    index: state === 'ok' || state === 'tooClose' ? idx : null,
  });

  return frameOf(b, protocol, 'min', {
    master: [null, null, null, null],
    slave: [null, null, null, null],
    masterStates: null,
    slaveStates: null,
    masterUnit: unit(masterState, masterMin, masterIdx),
    slaveUnit: unit(slaveState, slaveMin, slaveIdx),
    timeMs: u32(b, 8),
    ageByte: b[12],
  });
};

const parseFrame = (protocol: number) => (b: Uint8Array): MerakFrame | null => {
  const mode = b[1] & 0x0f;
  if (mode === 1) return parseRaw(b, protocol);
  if (mode === 2) return parseMin(b, protocol);
  return null;
};

/**
 * Frame parsers by protocol version (upper nibble of byte 1). A frame of any other version is reported
 * as `unsupported` (shown as hex) instead of being mis-parsed.
 */
export const FRAME_PARSERS: Record<number, (b: Uint8Array) => MerakFrame | null> = {
  1: parseFrame(1),
  2: parseFrame(2),
};

export const decodeAscii = (b: Uint8Array, from = 0): string => {
  let s = '';
  for (let i = from; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

export const encodeAscii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

export function parseNotification(b: Uint8Array): MerakMessage {
  if (b.length === 0) return { type: 'unknown', reason: 'empty notification' };

  switch (b[0]) {
    case TYPE_HEARTBEAT:
      return { type: 'heartbeat' };

    case TYPE_FRAME: {
      if (b.length < 2) return { type: 'unknown', reason: 'data frame shorter than 2 B' };
      const protocol = b[1] >> 4;
      const parser = FRAME_PARSERS[protocol];
      if (!parser) return { type: 'unsupported', protocol, length: b.length };
      const frame = parser(b);
      if (!frame) {
        return { type: 'unknown', reason: `malformed v${protocol} frame (${b.length} B, mode ${b[1] & 0x0f})` };
      }
      return { type: 'frame', frame };
    }

    case TYPE_REPLY:
      if (b.length < 5) return { type: 'unknown', reason: `reply shorter than 5 B (${b.length})` };
      return { type: 'reply', command: String.fromCharCode(b[1]), status: b[2], value: u16(b, 3) };

    case TYPE_TEXT:
      // The leading '>' is only a marker, not part of the message.
      return { type: 'text', text: decodeAscii(b, 1).replace(/\r?\n$/, '') };

    default:
      return { type: 'unknown', reason: `unknown notification type 0x${b[0].toString(16)}` };
  }
}

export interface Sides {
  /** Shortest valid distance of the left side in cm, null unless its state is 'ok'. */
  left: number | null;
  right: number | null;
  leftState: SensorState;
  rightState: SensorState;
  /** Sensor of the minimum / of the too-close reading, for the UI. */
  leftIndex: number | null;
  rightIndex: number | null;
}

/**
 * Reduce a frame to the two sides the backend stores (distance_left, distance_right).
 * The master unit is the left side by default; `swap` exchanges them. Both modes yield the same shape
 * because the unit summary follows the firmware rule in either mode.
 */
export function sidesFromFrame(frame: MerakFrame, swap = false): Sides {
  const left = swap ? frame.slaveUnit : frame.masterUnit;
  const right = swap ? frame.masterUnit : frame.slaveUnit;
  return {
    left: left.min,
    right: right.min,
    leftState: left.state,
    rightState: right.state,
    leftIndex: left.index,
    rightIndex: right.index,
  };
}
