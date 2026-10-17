/**
 * Differential test: the app parser must decode every frame exactly like the reference client
 * ClearWay-FW/client/meas_client.py, whose output the firmware author verified on real hardware.
 *
 * __tests__/fixtures/merak-frames.json contains
 * - real notifications recorded from ESP32bt_MeasLength running FW 4.0.0 (protocol 2), RAW and MIN,
 * - synthetic frames built like src/measure.cpp (buildRaw / buildMin / unitMin) for the states that
 *   cannot be produced on demand (too close, nothing in range, disconnected slave), in protocol 2 and 1,
 * each with the reference decoding ("ref"). Regenerate with the scripts described in the fixture.
 */
import { MerakFrame, SENSOR_STATES, parseNotification } from '../../services/merak/protocol';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('../fixtures/merak-frames.json') as {
  real: FixtureFrame[];
  synthetic: FixtureFrame[];
};

interface RefFrame {
  kind: 'raw' | 'min';
  proto: number;
  t_ms: number;
  state: number;
  age: number;
  master: (number | null)[];
  slave: (number | null)[];
  mstates: number[];
  sstates: number[];
  munit: number;
  sunit: number;
  master_min: number | null;
  slave_min: number | null;
  master_idx: number;
  slave_idx: number;
}

interface FixtureFrame {
  name: string;
  hex: string;
  ref: RefFrame;
}

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const decode = (hex: string): MerakFrame => {
  const msg = parseNotification(bytes(hex));
  if (msg.type !== 'frame') throw new Error(`not decoded as a frame: ${msg.type} ${JSON.stringify(msg)}`);
  return msg.frame;
};

/** The reference reports an index even when it is meaningless; it only matters for ok / too close. */
const refIndex = (state: number, idx: number): number | null => (state === 0 || state === 1 ? idx : null);

const check = (f: MerakFrame, ref: RefFrame) => {
  expect(f.mode).toBe(ref.kind);
  expect(f.protocol).toBe(ref.proto);
  expect(f.timeMs).toBe(ref.t_ms);
  expect(f.slaveConnected).toBe((ref.state & 1) === 1);
  expect(f.measuringRunning).toBe((ref.state & 2) === 2);
  expect(f.slaveAgeMs).toBe(ref.age === 0xff ? null : ref.age * 10);

  expect(f.masterUnit.state).toBe(SENSOR_STATES[ref.munit]);
  expect(f.slaveUnit.state).toBe(SENSOR_STATES[ref.sunit]);
  expect(f.masterUnit.min).toBe(ref.master_min);
  expect(f.slaveUnit.min).toBe(ref.slave_min);
  expect(f.masterUnit.index).toBe(refIndex(ref.munit, ref.master_idx));
  expect(f.slaveUnit.index).toBe(refIndex(ref.sunit, ref.slave_idx));

  if (ref.kind === 'raw') {
    expect(f.master).toEqual(ref.master);
    expect(f.slave).toEqual(ref.slave);
    expect(f.masterStates).toEqual(ref.mstates.map((s) => SENSOR_STATES[s]));
    expect(f.slaveStates).toEqual(ref.sstates.map((s) => SENSOR_STATES[s]));
  }
};

describe('real frames recorded from the unit (FW 4.0.0, protocol 2)', () => {
  it('contains both RAW (27 B, 0x21) and MIN (14 B, 0x22) frames', () => {
    const raw = fixture.real.filter((e) => e.ref.kind === 'raw');
    const min = fixture.real.filter((e) => e.ref.kind === 'min');
    expect(raw.length).toBeGreaterThanOrEqual(20);
    expect(min.length).toBeGreaterThanOrEqual(20);
    expect(raw.every((e) => e.hex.length === 54 && e.hex.startsWith('aa21'))).toBe(true);
    expect(min.every((e) => e.hex.length === 28 && e.hex.startsWith('aa22'))).toBe(true);
  });

  it.each(fixture.real.map((e) => [e.name, e] as const))('%s decodes like the reference client', (_name, e) => {
    check(decode(e.hex), e.ref);
  });

  it('shows the known bench state: master J3 faulty, the other seven sensors valid', () => {
    const raw = fixture.real.filter((e) => e.ref.kind === 'raw').map((e) => decode(e.hex));
    for (const f of raw) {
      expect(f.masterStates).toEqual(['ok', 'ok', 'fault', 'ok']);
      expect(f.slaveStates).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(f.masterUnit.state).toBe('ok');
      expect(f.slaveUnit.state).toBe('ok');
      // plausible distances of the bench setup (~4 m to the wall)
      expect(f.masterUnit.min).toBeGreaterThan(300);
      expect(f.masterUnit.min).toBeLessThan(600);
    }
  });

  it('has the time running forward in steps of the 10 Hz rate', () => {
    const raw = fixture.real.filter((e) => e.ref.kind === 'raw').map((e) => decode(e.hex).timeMs);
    for (let i = 1; i < raw.length; i++) {
      expect(raw[i]).toBeGreaterThan(raw[i - 1]);
      expect(raw[i] - raw[i - 1]).toBeLessThan(250);
    }
  });
});

describe('synthetic frames per src/measure.cpp, protocol 2 and 1', () => {
  it.each(fixture.synthetic.map((e) => [e.name, e] as const))('%s decodes like the reference client', (_name, e) => {
    check(decode(e.hex), e.ref);
  });

  it('covers every unit state in both modes', () => {
    const states = new Set(fixture.synthetic.flatMap((e) => [`${e.ref.kind}:${e.ref.munit}`, `${e.ref.kind}:${e.ref.sunit}`]));
    for (const kind of ['raw', 'min']) for (const s of [0, 1, 2, 3]) expect(states.has(`${kind}:${s}`)).toBe(true);
  });
});
