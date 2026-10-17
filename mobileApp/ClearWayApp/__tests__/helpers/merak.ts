/**
 * Test helpers: byte-exact frames as the firmware sends them (specifikace-zarizeni.md 4.5 - 4.8)
 * and a fake BLE transport that behaves like the measuring unit.
 */
import type { MerakTransport, TransportHandlers, TransportInfo } from '../../services/merak/transport.types';

const be16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
const be32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

export const INVALID = 0xffff;

export interface RawFrameOptions {
  /** bit 0-3 master J1-J4, bit 4-7 slave S1-S4 */
  bitmap?: number;
  /** 8 values: master J1-J4, then slave S1-S4 (cm) */
  values?: number[];
  status?: number;
  timeMs?: number;
  /** slave age in 10 ms units, 0xFF = unknown */
  age?: number;
  protocol?: number;
}

/** 25 B raw frame, protocol v1. */
export function rawFrame(o: RawFrameOptions = {}): Uint8Array {
  const values = o.values ?? [120, 130, 140, 150, 200, 210, 220, 230];
  return Uint8Array.from([
    0xaa,
    ((o.protocol ?? 1) << 4) | 0x01,
    o.bitmap ?? 0xff,
    o.status ?? 0x03,
    ...values.flatMap(be16),
    ...be32(o.timeMs ?? 1234),
    o.age ?? 2,
  ]);
}

export interface MinFrameOptions {
  masterValid?: boolean;
  slaveValid?: boolean;
  masterIndex?: number;
  slaveIndex?: number;
  master?: number;
  slave?: number;
  status?: number;
  timeMs?: number;
  age?: number;
  protocol?: number;
}

/** 13 B min frame, protocol v1. */
export function minFrame(o: MinFrameOptions = {}): Uint8Array {
  const flags =
    (o.masterValid ?? true ? 0x01 : 0) |
    (o.slaveValid ?? true ? 0x02 : 0) |
    (((o.masterIndex ?? 0) & 0x03) << 2) |
    (((o.slaveIndex ?? 0) & 0x03) << 4);
  return Uint8Array.from([
    0xaa,
    ((o.protocol ?? 1) << 4) | 0x02,
    flags,
    o.status ?? 0x03,
    ...be16(o.master ?? 118),
    ...be16(o.slave ?? 132),
    ...be32(o.timeMs ?? 5000),
    o.age ?? 1,
  ]);
}

/** Sensor state codes of protocol 2 (spec 3.3). */
export const ST = { OK: 0, CLOSE: 1, NOTARGET: 2, FAULT: 3 } as const;

const pack = (states: number[]) => states.reduce((b, st, i) => b | (st << (2 * i)), 0);

/** unitMin() of src/measure.cpp: first too-close wins, else minimum of OK (first index), else no target, else fault. */
const unitMin = (states: number[], values: number[]): [number, number, number] => {
  const close = states.indexOf(ST.CLOSE);
  if (close >= 0) return [ST.CLOSE, INVALID, close];
  let best: [number, number, number] | null = null;
  states.forEach((st, i) => {
    if (st === ST.OK && (best === null || values[i] < best[1])) best = [ST.OK, values[i], i];
  });
  if (best) return best;
  return states.includes(ST.NOTARGET) ? [ST.NOTARGET, INVALID, 0] : [ST.FAULT, INVALID, 0];
};

export interface V2Options {
  master?: number[];
  slave?: number[];
  masterStates?: number[];
  slaveStates?: number[];
  slaveConnected?: boolean;
  timeMs?: number;
  /** slave age in 10 ms units, 0xFF = unknown */
  age?: number;
}

const v2defaults = (o: V2Options) => ({
  master: o.master ?? [423, 425, 410, 423],
  slave: o.slave ?? [424, 429, 417, 425],
  ms: o.masterStates ?? [ST.OK, ST.OK, ST.OK, ST.OK],
  ss: o.slaveStates ?? [ST.OK, ST.OK, ST.OK, ST.OK],
  status: (o.slaveConnected ?? true ? 0x01 : 0) | 0x02,
  timeMs: o.timeMs ?? 1234,
  age: o.age ?? 2,
});

/** 27 B raw frame, protocol 2, built like buildRaw() in src/measure.cpp. */
export function rawFrameV2(o: V2Options = {}): Uint8Array {
  const d = v2defaults(o);
  const bitmap =
    d.ms.reduce((b, st, i) => b | (st === ST.OK ? 1 << i : 0), 0) |
    (d.ss.reduce((b, st, i) => b | (st === ST.OK ? 1 << i : 0), 0) << 4);
  const values = [...d.master.map((v, i) => (d.ms[i] === ST.OK ? v : INVALID)), ...d.slave.map((v, i) => (d.ss[i] === ST.OK ? v : INVALID))];
  return Uint8Array.from([
    0xaa, 0x21, bitmap, d.status,
    ...values.flatMap(be16),
    ...be32(d.timeMs),
    d.age, pack(d.ms), pack(d.ss),
  ]);
}

/** 14 B min frame, protocol 2, built like buildMin() in src/measure.cpp. */
export function minFrameV2(o: V2Options = {}): Uint8Array {
  const d = v2defaults(o);
  const m = unitMin(d.ms, d.master);
  const s = unitMin(d.ss, d.slave);
  const flags = (m[0] === ST.OK ? 0x01 : 0) | (s[0] === ST.OK ? 0x02 : 0) | (m[2] << 2) | (s[2] << 4);
  return Uint8Array.from([
    0xaa, 0x22, flags, d.status,
    ...be16(m[1]), ...be16(s[1]),
    ...be32(d.timeMs),
    d.age, m[0] | (s[0] << 2),
  ]);
}

/** 5 B machine reply. */
export const reply = (letter: string, status: number, value: number): Uint8Array =>
  Uint8Array.from([0xbb, letter.charCodeAt(0), status, ...be16(value)]);

/** Text notification: '>' marker + ASCII. */
export const text = (s: string): Uint8Array => Uint8Array.from([0x3e, ...Array.from(s, (c) => c.charCodeAt(0))]);

export const heartbeat = (): Uint8Array => Uint8Array.from([0x2a]);

export const ascii = (b: Uint8Array): string => String.fromCharCode(...Array.from(b));

type Responder = (command: string, device: FakeTransport) => Uint8Array[] | null | undefined;

/**
 * Fake of the measuring unit. By default it answers like firmware 3.6.0 (dev build, MIN mode,
 * 10 Hz, M toggles). Override `responder` to simulate refusals, silence or long outputs.
 */
export class FakeTransport implements MerakTransport {
  handlers: TransportHandlers | null = null;
  written: string[] = [];
  running = false;
  supported = true;
  failConnect: Error | null = null;
  responder: Responder | null = null;
  disconnects = 0;

  isSupported(): boolean {
    return this.supported;
  }

  async connect(handlers: TransportHandlers): Promise<TransportInfo> {
    if (this.failConnect) throw this.failConnect;
    this.handlers = handlers;
    return { name: 'ESP32bt_MeasLength', mtu: 247 };
  }

  async write(data: Uint8Array): Promise<void> {
    const command = ascii(data);
    this.written.push(command);
    const replies = (this.responder ? this.responder(command, this) : undefined) ?? this.defaultReplies(command);
    // Answer asynchronously, like a BLE notification arriving after the write.
    setTimeout(() => replies.forEach((r) => this.handlers?.onData(r)), 0);
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
  }

  /** Push a notification as if the device sent it. */
  push(bytes: Uint8Array): void {
    this.handlers?.onData(bytes);
  }

  /** Simulate the link going down. */
  drop(reason?: string): void {
    this.handlers?.onDisconnect(reason);
  }

  private defaultReplies(command: string): Uint8Array[] {
    switch (command) {
      case 'M':
        this.running = !this.running;
        return [reply('M', 0, this.running ? 1 : 0), text(this.running ? 'Measurement STARTING!' : 'Measurement STOPPED!')];
      case 'A0':
        return [reply('A', 0, 2), text('Mode MIN')];
      case 'A1':
        return [reply('A', 0, 1), text('Mode RAW')];
      case 'V':
        return [
          reply('V', 0, 1),
          text('FW 3.6.0 role MASTER protocol 1 SN 3485184546E5 DEV BUILD (no encryption)'),
        ];
      case 'I':
        return [reply('I', 0, 0xf7), text('Valid master=1110 slave=1111')];
      default:
        if (/^R\d+$/.test(command)) return [reply('R', 0, Number(command.slice(1))), text(`Rate ${command.slice(1)} Hz`)];
        return [reply(command.charAt(0), 2, 0), text(`Unknown command: ${command}`)];
    }
  }
}

// ── context stub for component / hook tests ──────────────────────────────────

import { MerakStore } from '../../services/merak/merak.store';
import type { BleContextValue } from '../../contexts/BleContext';

/** A BleContextValue with jest.fn() for every action; override what the test needs. */
export function makeBle(overrides: Partial<BleContextValue> = {}): BleContextValue {
  return {
    supported: true,
    status: 'disconnected',
    deviceName: null,
    mtu: null,
    error: null,
    linkOk: false,
    mode: 'min',
    rateHz: 10,
    swapSides: false,
    profile: '4.0',
    deviceInfo: null,
    measuring: false,
    store: new MerakStore(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    setMode: jest.fn().mockResolvedValue(true),
    setRate: jest.fn().mockResolvedValue(true),
    setSwapSides: jest.fn(),
    setProfile: jest.fn(),
    sendCommand: jest.fn(),
    runCommand: jest.fn(),
    startMeasurement: jest.fn().mockResolvedValue(true),
    stopMeasurement: jest.fn().mockResolvedValue(true),
    getLatestSides: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}
