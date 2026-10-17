/**
 * Measuring unit protocol - byte-exact frames from specifikace-zarizeni.md (4.4 - 4.9).
 *
 * Key invariants:
 * - validity comes from the bitmap, an 0xFFFF value is invalid even when the bit is set
 * - all multi-byte values are big endian
 * - a frame of an unknown protocol version is reported, never mis-parsed as v1
 */
import { base64ToBytes, bytesToBase64 } from '../../services/merak/base64';
import { MerakFrame, encodeAscii, parseNotification, replyStatusLabel, sidesFromFrame, toHex } from '../../services/merak/protocol';
import { MerakStore } from '../../services/merak/merak.store';
import { INVALID, heartbeat, minFrame, rawFrame, reply, text } from '../helpers/merak';

const frameOf = (bytes: Uint8Array): MerakFrame => {
  const msg = parseNotification(bytes);
  if (msg.type !== 'frame') throw new Error(`expected frame, got ${msg.type}`);
  return msg.frame;
};

describe('heartbeat', () => {
  it('is a single 0x2A byte', () => {
    expect(parseNotification(heartbeat())).toEqual({ type: 'heartbeat' });
  });
});

describe('raw frame (25 B)', () => {
  it('decodes all eight distances big endian', () => {
    const f = frameOf(rawFrame({ values: [120, 130, 140, 150, 200, 210, 220, 230] }));
    expect(f.mode).toBe('raw');
    expect(f.protocol).toBe(1);
    expect(f.master).toEqual([120, 130, 140, 150]);
    expect(f.slave).toEqual([200, 210, 220, 230]);
    expect(f.length).toBe(25);
  });

  it('decodes values above 255 correctly (two byte values)', () => {
    const f = frameOf(rawFrame({ values: [300, 513, 800, 1200, 1, 256, 257, 65534] }));
    expect(f.master).toEqual([300, 513, 800, 1200]);
    expect(f.slave).toEqual([1, 256, 257, 65534]);
  });

  it('computes the minimum per unit and which sensor gave it', () => {
    const f = frameOf(rawFrame({ values: [150, 120, 140, 130, 230, 220, 210, 200] }));
    expect(f.masterMin).toBe(120);
    expect(f.masterMinIndex).toBe(1);
    expect(f.slaveMin).toBe(200);
    expect(f.slaveMinIndex).toBe(3);
  });

  it('marks a sensor invalid when its validity bit is 0', () => {
    // master J1 and slave S4 invalid
    const f = frameOf(rawFrame({ bitmap: 0b0111_1110, values: [50, 130, 140, 150, 200, 210, 220, 10] }));
    expect(f.master[0]).toBeNull();
    expect(f.slave[3]).toBeNull();
    // the invalid values (50, 10) must not become the minimum
    expect(f.masterMin).toBe(130);
    expect(f.slaveMin).toBe(200);
  });

  it('treats 0xFFFF as invalid even with the validity bit set', () => {
    const f = frameOf(rawFrame({ bitmap: 0xff, values: [INVALID, 130, 140, 150, 200, 210, 220, 230] }));
    expect(f.master[0]).toBeNull();
    expect(f.masterMin).toBe(130);
  });

  it('reports no minimum when the whole unit is invalid (slave missing)', () => {
    const f = frameOf(
      rawFrame({ bitmap: 0x0f, values: [120, 130, 140, 150, INVALID, INVALID, INVALID, INVALID], status: 0x02, age: 0xff })
    );
    expect(f.slave).toEqual([null, null, null, null]);
    expect(f.slaveMin).toBeNull();
    expect(f.slaveMinIndex).toBeNull();
    expect(f.slaveConnected).toBe(false);
    expect(f.slaveAgeMs).toBeNull();
  });

  it('decodes status bits, time and slave age', () => {
    const f = frameOf(rawFrame({ status: 0x03, timeMs: 0x01020304, age: 7 }));
    expect(f.slaveConnected).toBe(true);
    expect(f.measuringRunning).toBe(true);
    expect(f.timeMs).toBe(0x01020304);
    expect(f.slaveAgeMs).toBe(70);

    const stopped = frameOf(rawFrame({ status: 0x00 }));
    expect(stopped.slaveConnected).toBe(false);
    expect(stopped.measuringRunning).toBe(false);
  });

  it('keeps the time unsigned above 2^31', () => {
    expect(frameOf(rawFrame({ timeMs: 0xfffffff0 })).timeMs).toBe(0xfffffff0);
  });
});

describe('min frame (13 B)', () => {
  it('decodes both minima, their sensor indexes and the timing', () => {
    const f = frameOf(minFrame({ master: 118, slave: 132, masterIndex: 2, slaveIndex: 3, timeMs: 5000, age: 4 }));
    expect(f.mode).toBe('min');
    expect(f.length).toBe(13);
    expect(f.masterMin).toBe(118);
    expect(f.slaveMin).toBe(132);
    expect(f.masterMinIndex).toBe(2);
    expect(f.slaveMinIndex).toBe(3);
    expect(f.timeMs).toBe(5000);
    expect(f.slaveAgeMs).toBe(40);
  });

  it('reports a unit whose validity bit is 0 as null', () => {
    const f = frameOf(minFrame({ slaveValid: false, slave: INVALID, status: 0x02, age: 0xff }));
    expect(f.masterMin).toBe(118);
    expect(f.slaveMin).toBeNull();
    expect(f.slaveMinIndex).toBeNull();
    expect(f.slaveConnected).toBe(false);
  });

  it('has no per-sensor values', () => {
    const f = frameOf(minFrame());
    expect(f.master).toEqual([null, null, null, null]);
    expect(f.slave).toEqual([null, null, null, null]);
  });
});

describe('frames that cannot be used', () => {
  it('reports a protocol version without a parser instead of parsing it as v1', () => {
    // protocols 1 and 2 are known; a future 3 must not be mis-read
    const msg = parseNotification(rawFrame({ protocol: 3 }));
    expect(msg).toEqual({ type: 'unsupported', protocol: 3, length: 25 });
  });

  it('rejects a truncated raw frame', () => {
    const msg = parseNotification(rawFrame().slice(0, 24));
    expect(msg.type).toBe('unknown');
  });

  it('rejects a truncated min frame', () => {
    expect(parseNotification(minFrame().slice(0, 12)).type).toBe('unknown');
  });

  it('rejects an unknown mode nibble', () => {
    const bytes = rawFrame();
    bytes[1] = 0x13;
    expect(parseNotification(bytes).type).toBe('unknown');
  });

  it('ignores an unknown notification type and an empty one', () => {
    expect(parseNotification(Uint8Array.from([0x01, 0x02])).type).toBe('unknown');
    expect(parseNotification(new Uint8Array(0)).type).toBe('unknown');
  });
});

describe('machine reply (0xBB, 5 B)', () => {
  it('decodes command letter, status and a big endian value', () => {
    expect(parseNotification(reply('R', 0, 100))).toEqual({ type: 'reply', command: 'R', status: 0, value: 100 });
    expect(parseNotification(reply('I', 0, 0x01f7))).toEqual({ type: 'reply', command: 'I', status: 0, value: 0x01f7 });
  });

  it('decodes the service command letter', () => {
    expect(parseNotification(reply('!', 1, 0))).toMatchObject({ command: '!', status: 1 });
  });

  it('rejects a short reply', () => {
    expect(parseNotification(Uint8Array.from([0xbb, 0x4d, 0x00]))).toMatchObject({ type: 'unknown' });
  });

  it('labels every status from the specification', () => {
    expect(replyStatusLabel(0)).toBe('OK');
    expect(replyStatusLabel(1)).toBe('hodnota mimo rozsah');
    expect(replyStatusLabel(2)).toBe('neznámý příkaz');
    expect(replyStatusLabel(3)).toBe('nelze provést');
    expect(replyStatusLabel(4)).toBe('interní chyba zařízení');
    expect(replyStatusLabel(9)).toContain('9');
  });
});

describe('text reply (0x3E)', () => {
  it('drops the leading marker and decodes ASCII', () => {
    expect(parseNotification(text('Measurement STARTING!'))).toEqual({ type: 'text', text: 'Measurement STARTING!' });
  });

  it('strips a trailing newline', () => {
    expect(parseNotification(text('Rate 20 Hz\n'))).toEqual({ type: 'text', text: 'Rate 20 Hz' });
  });
});

describe('sidesFromFrame', () => {
  it('uses master as left and slave as right by default', () => {
    const f = frameOf(minFrame({ master: 118, slave: 132 }));
    expect(sidesFromFrame(f)).toMatchObject({ left: 118, right: 132, leftState: 'ok', rightState: 'ok' });
  });

  it('swaps the sides on request', () => {
    const f = frameOf(minFrame({ master: 118, slave: 132 }));
    expect(sidesFromFrame(f, true)).toMatchObject({ left: 132, right: 118 });
  });

  it('reduces raw mode to the same shape (minimum per unit)', () => {
    const f = frameOf(rawFrame({ values: [150, 120, 140, 130, 230, 220, 210, 200] }));
    expect(sidesFromFrame(f)).toMatchObject({ left: 120, right: 200, leftIndex: 1, rightIndex: 3 });
  });

  it('returns null for a missing side instead of inventing a value', () => {
    const f = frameOf(minFrame({ slaveValid: false, slave: INVALID }));
    // protocol 1 has no states: an invalid unit is reported as a fault
    expect(sidesFromFrame(f)).toMatchObject({ left: 118, right: null, rightState: 'fault' });
  });
});

describe('helpers', () => {
  it('round-trips bytes through base64 for every length remainder', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 25, 247]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('encodes the same base64 as the platform for a known value', () => {
    expect(bytesToBase64(encodeAscii('R10'))).toBe('UjEw');
    expect(Array.from(base64ToBytes('UjEw'))).toEqual([0x52, 0x31, 0x30]);
  });

  it('formats hex for the protocol debug line', () => {
    expect(toHex(Uint8Array.from([0xaa, 0x01, 0x0f]))).toBe('aa 01 0f');
  });
});

describe('MerakStore', () => {
  it('counts frames, replies and heartbeats and exposes the latest frame', () => {
    const store = new MerakStore();
    store.ingest(heartbeat(), 1000);
    store.ingest(minFrame({ master: 111 }), 1100);
    store.ingest(minFrame({ master: 112 }), 1200);
    store.ingest(reply('M', 0, 1), 1250);
    const snap = store.getSnapshot(1300);
    expect(snap.heartbeats).toBe(1);
    expect(snap.frames).toBe(2);
    expect(snap.replies).toBe(1);
    expect(snap.frame?.masterMin).toBe(112);
    expect(snap.frameAt).toBe(1200);
    expect(snap.lastHex).toBe(toHex(minFrame({ master: 112 })));
  });

  it('measures frames per second over the recent window', () => {
    const store = new MerakStore();
    for (let i = 0; i < 11; i++) store.ingest(minFrame(), 1000 + i * 100); // 10 Hz
    expect(store.getSnapshot(2000).fps).toBeCloseTo(10, 1);
  });

  it('reports 0 fps when the frames stopped', () => {
    const store = new MerakStore();
    for (let i = 0; i < 5; i++) store.ingest(minFrame(), 1000 + i * 100);
    expect(store.getSnapshot(10000).fps).toBe(0);
  });

  it('keeps unsupported frames out of the frame counter but remembers their hex', () => {
    const store = new MerakStore();
    store.ingest(rawFrame({ protocol: 3 }), 1000);
    const snap = store.getSnapshot(1000);
    expect(snap.frames).toBe(0);
    expect(snap.unsupported).toBe(1);
    expect(snap.lastUnsupported?.protocol).toBe(3);
    expect(snap.lastUnsupported?.hex.startsWith('aa 31')).toBe(true);
  });

  it('logs malformed notifications as errors', () => {
    const store = new MerakStore();
    store.ingest(Uint8Array.from([0x77]), 1000);
    const snap = store.getSnapshot(1000);
    expect(snap.malformed).toBe(1);
    expect(snap.log[snap.log.length - 1].kind).toBe('error');
  });

  it('caps the log length', () => {
    const store = new MerakStore();
    for (let i = 0; i < 500; i++) store.addLog('event', `line ${i}`);
    const snap = store.getSnapshot();
    expect(snap.log.length).toBe(200);
    expect(snap.log[snap.log.length - 1].text).toBe('line 499');
  });
});
