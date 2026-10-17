/**
 * Protocol 2 (FW 4.0.0): sensor states, unit rule, console formatting, what gets stored, data log.
 *
 * Key invariants:
 * - "too close" of any sensor makes the unit "too close" (firmware: false alarm beats a missed obstacle)
 * - the app never stores an invented distance: noTarget / fault skip the sample, tooClose is stored as 0 cm
 * - the console shows frames the same way as client/meas_client.py
 * - the stream of frames never pushes commands out of the event log
 */
import { formatFrame, isAlarm, unitText } from '../../services/merak/format';
import { MerakStore } from '../../services/merak/merak.store';
import {
  MerakFrame,
  parseNotification,
  sidesFromFrame,
  toHex,
  unitReading,
  unpackStates,
} from '../../services/merak/protocol';
import { STATE_LABEL, TOO_CLOSE_STORED_CM, storedDistance } from '../../services/merak/storage-policy';
import { ST, heartbeat, minFrameV2, rawFrameV2 } from '../helpers/merak';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('../fixtures/merak-frames.json') as { synthetic: { name: string; hex: string }[] };

const frameOf = (bytes: Uint8Array): MerakFrame => {
  const msg = parseNotification(bytes);
  if (msg.type !== 'frame') throw new Error(`expected frame, got ${msg.type}`);
  return msg.frame;
};

const hexOf = (b: Uint8Array) => toHex(b).replace(/ /g, '');
const fixtureHex = (name: string) => {
  const e = fixture.synthetic.find((x) => x.name === name);
  if (!e) throw new Error(`fixture entry missing: ${name}`);
  return e.hex;
};

describe('test frame builders match the firmware layout byte for byte', () => {
  // The Python builder in the fixture mirrors src/measure.cpp; the TS builders must produce the same bytes.
  it('raw v2', () => {
    const b = rawFrameV2({
      master: [423, 425, 410, 423],
      masterStates: [ST.OK, ST.OK, ST.FAULT, ST.OK],
      slave: [424, 429, 417, 425],
      timeMs: 0x01020304,
      age: 2,
    });
    expect(hexOf(b)).toBe(fixtureHex('raw v2: master J3 fault (real bench state)'));
  });

  it('min v2 with "too close" winning over a smaller valid value', () => {
    const b = minFrameV2({
      master: [15, 300, 400, 500],
      masterStates: [ST.OK, ST.OK, ST.OK, ST.CLOSE],
      slave: [424, 429, 417, 425],
      timeMs: 0xfffffff0,
      age: 2,
    });
    expect(hexOf(b)).toBe(fixtureHex('min v2: too close wins over a smaller valid value'));
  });

  it('min v2 with a disconnected slave', () => {
    const b = minFrameV2({
      master: [423, 425, 410, 423],
      slave: [424, 429, 417, 425],
      slaveStates: [ST.FAULT, ST.FAULT, ST.FAULT, ST.FAULT],
      slaveConnected: false,
      timeMs: 0xfffffff0,
      age: 0xff,
    });
    expect(hexOf(b)).toBe(fixtureHex('min v2: slave disconnected'));
  });
});

describe('unpackStates / unitReading', () => {
  it('unpacks 2 bits per sensor, sensor i on bits 2i..2i+1', () => {
    // J1 ok, J2 too close, J3 no target, J4 fault = 0b11_10_01_00
    expect(unpackStates(0b11100100)).toEqual(['ok', 'tooClose', 'noTarget', 'fault']);
    expect(unpackStates(0x30)).toEqual(['ok', 'ok', 'fault', 'ok']); // the real bench byte
  });

  it('makes the unit "too close" when any sensor is, reporting the first such sensor', () => {
    expect(unitReading(['ok', 'tooClose', 'ok', 'tooClose'], [100, null, 50, null])).toEqual({
      state: 'tooClose',
      min: null,
      index: 1,
    });
  });

  it('otherwise takes the minimum of the OK sensors (first one on a tie)', () => {
    expect(unitReading(['ok', 'ok', 'ok', 'ok'], [300, 200, 200, 400])).toEqual({ state: 'ok', min: 200, index: 1 });
  });

  it('prefers a valid value over "nothing in range"', () => {
    expect(unitReading(['noTarget', 'ok', 'noTarget', 'fault'], [null, 420, null, null])).toEqual({
      state: 'ok',
      min: 420,
      index: 1,
    });
  });

  it('reports "nothing in range" before a fault, and a fault when every sensor is silent', () => {
    expect(unitReading(['fault', 'noTarget', 'fault', 'fault'], [null, null, null, null]).state).toBe('noTarget');
    expect(unitReading(['fault', 'fault', 'fault', 'fault'], [null, null, null, null]).state).toBe('fault');
  });
});

describe('protocol 2 frames', () => {
  it('raw: per-sensor states and the unit summary', () => {
    const f = frameOf(rawFrameV2({ masterStates: [ST.OK, ST.CLOSE, ST.NOTARGET, ST.FAULT] }));
    expect(f.protocol).toBe(2);
    expect(f.length).toBe(27);
    expect(f.masterStates).toEqual(['ok', 'tooClose', 'noTarget', 'fault']);
    expect(f.master).toEqual([423, null, null, null]);
    expect(f.masterUnit).toEqual({ state: 'tooClose', min: null, index: 1 });
    expect(f.slaveUnit).toEqual({ state: 'ok', min: 417, index: 2 });
  });

  it('min: unit states from byte 13 and the too-close sensor index', () => {
    const f = frameOf(minFrameV2({ masterStates: [ST.OK, ST.OK, ST.CLOSE, ST.OK] }));
    expect(f.length).toBe(14);
    expect(f.masterUnit).toEqual({ state: 'tooClose', min: null, index: 2 });
    expect(f.slaveUnit.state).toBe('ok');
    expect(f.masterStates).toBeNull(); // min frames carry no per-sensor detail
  });

  it('min: index is dropped when it means nothing (no target / fault)', () => {
    const f = frameOf(minFrameV2({ slaveStates: [ST.NOTARGET, ST.NOTARGET, ST.FAULT, ST.FAULT] }));
    expect(f.slaveUnit).toEqual({ state: 'noTarget', min: null, index: null });
  });

  it('rejects a protocol 2 frame with the protocol 1 length', () => {
    expect(parseNotification(rawFrameV2().slice(0, 25)).type).toBe('unknown');
    expect(parseNotification(minFrameV2().slice(0, 13)).type).toBe('unknown');
  });

  it('never treats a value as valid when its bitmap bit is cleared, even if the state says ok', () => {
    const b = rawFrameV2();
    b[2] &= ~0x01; // clear J1 validity, keep state ok and the value
    const f = frameOf(b);
    expect(f.master[0]).toBeNull();
    expect(f.masterStates?.[0]).toBe('fault');
  });
});

describe('sidesFromFrame with states', () => {
  it('carries state and sensor index of each side', () => {
    const f = frameOf(minFrameV2({ masterStates: [ST.OK, ST.CLOSE, ST.OK, ST.OK] }));
    expect(sidesFromFrame(f)).toEqual({
      left: null,
      right: 417,
      leftState: 'tooClose',
      rightState: 'ok',
      leftIndex: 1,
      rightIndex: 2,
    });
  });

  it('gives the same sides from RAW and MIN frames of the same reading', () => {
    const opts = { masterStates: [ST.OK, ST.OK, ST.FAULT, ST.OK], slaveStates: [ST.NOTARGET, ST.OK, ST.OK, ST.OK] };
    expect(sidesFromFrame(frameOf(rawFrameV2(opts)))).toEqual(sidesFromFrame(frameOf(minFrameV2(opts))));
  });
});

describe('storage policy', () => {
  it('stores the distance of an ok side', () => {
    expect(storedDistance('ok', 418)).toBe(418);
  });

  it('stores a too-close side as 0 cm, the worst case', () => {
    expect(TOO_CLOSE_STORED_CM).toBe(0);
    expect(storedDistance('tooClose', null)).toBe(0);
  });

  it('never invents a distance for nothing in range or a fault', () => {
    expect(storedDistance('noTarget', null)).toBeNull();
    expect(storedDistance('fault', null)).toBeNull();
  });

  it('labels every state in Czech', () => {
    expect(STATE_LABEL).toEqual({ ok: 'OK', tooClose: 'příliš blízko', noTarget: 'nic v dosahu', fault: 'porucha' });
  });
});

describe('console format (same as meas_client.py)', () => {
  it('formats a MIN frame on one line', () => {
    const f = frameOf(minFrameV2({ master: [426, 430, 440, 450], slave: [430, 425, 418, 422], timeMs: 1234 }));
    expect(formatFrame(f)).toBe('MIN  master 426 cm (J1) · slave 418 cm (S3) · t=1234 ms');
  });

  it('formats a RAW frame with every sensor and the minimum in brackets', () => {
    const f = frameOf(rawFrameV2({ masterStates: [ST.OK, ST.OK, ST.FAULT, ST.OK], master: [423, 425, 0, 423], timeMs: 7 }));
    expect(formatFrame(f)).toBe(
      'RAW  master 423 cm (J1) · slave 417 cm (S3) · t=7 ms\n' +
        '     J1=[423] J2=425 J3=PORUCHA J4=423 | S1=424 S2=429 S3=[417] S4=425'
    );
  });

  it('writes the states of the sensors', () => {
    const f = frameOf(
      rawFrameV2({ masterStates: [ST.CLOSE, ST.NOTARGET, ST.FAULT, ST.OK], slaveStates: [ST.FAULT, ST.FAULT, ST.FAULT, ST.FAULT], slaveConnected: false })
    );
    const text = formatFrame(f);
    expect(text).toContain('master PŘÍLIŠ BLÍZKO (J1)');
    expect(text).toContain('slave PORUCHA (slave nepřipojen)');
    expect(text).toContain('J1=BLÍZKO J2=-- J3=PORUCHA J4=423');
  });

  it('describes a unit', () => {
    expect(unitText({ state: 'ok', min: 120, index: 3 }, 'S')).toBe('120 cm (S4)');
    expect(unitText({ state: 'noTarget', min: null, index: null }, 'J')).toBe('nic v dosahu');
  });

  it('flags a too-close frame as an alarm', () => {
    expect(isAlarm(frameOf(minFrameV2({ slaveStates: [ST.OK, ST.OK, ST.OK, ST.CLOSE] })))).toBe(true);
    expect(isAlarm(frameOf(minFrameV2()))).toBe(false);
  });
});

describe('data log of the store', () => {
  it('records frames decoded, with hex, and heartbeats', () => {
    const store = new MerakStore();
    store.ingest(heartbeat(), 1000);
    store.ingest(minFrameV2({ timeMs: 99 }), 1100);
    const { dataLog } = store.getSnapshot(1200);
    expect(dataLog.map((d) => d.kind)).toEqual(['heartbeat', 'frame']);
    expect(dataLog[1].text).toContain('MIN  master');
    expect(dataLog[1].hex.startsWith('aa 22')).toBe(true);
    expect(dataLog[1].alarm).toBe(false);
  });

  it('marks too-close frames', () => {
    const store = new MerakStore();
    store.ingest(minFrameV2({ masterStates: [ST.CLOSE, ST.OK, ST.OK, ST.OK] }), 1000);
    expect(store.getSnapshot(1000).dataLog[0].alarm).toBe(true);
  });

  it('keeps commands in the event log however many frames arrive', () => {
    const store = new MerakStore();
    store.addLog('tx', 'M', 1000);
    for (let i = 0; i < 2000; i++) store.ingest(minFrameV2({ timeMs: i }), 1001 + i);
    const snap = store.getSnapshot(5000);
    expect(snap.log.some((e) => e.kind === 'tx' && e.text === 'M')).toBe(true);
    expect(snap.dataLog.length).toBe(400);
    expect(snap.dataLog[snap.dataLog.length - 1].text).toContain('t=1999 ms');
  });

  it('gives frames and events one ordering', () => {
    const store = new MerakStore();
    store.addLog('tx', 'M', 1000);
    store.ingest(minFrameV2(), 1001);
    store.addLog('tx', 'M', 1002);
    const snap = store.getSnapshot(1003);
    const ids = [snap.log[0].id, snap.dataLog[0].id, snap.log[1].id];
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('records frames of an unknown protocol and malformed notifications', () => {
    const store = new MerakStore();
    const unknown = rawFrameV2();
    unknown[1] = 0x31;
    store.ingest(unknown, 1000);
    store.ingest(Uint8Array.from([0x77, 0x01]), 1001);
    expect(store.getSnapshot(1002).dataLog.map((d) => d.kind)).toEqual(['unsupported', 'malformed']);
  });

  it('clears both logs', () => {
    const store = new MerakStore();
    store.addLog('tx', 'M');
    store.ingest(minFrameV2());
    store.clearLog();
    const snap = store.getSnapshot();
    expect(snap.log).toEqual([]);
    expect(snap.dataLog).toEqual([]);
  });
});
