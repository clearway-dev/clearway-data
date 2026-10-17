/**
 * BleContext - connection, command queue and measurement control against a fake measuring unit.
 *
 * Key invariants:
 * - the unit is configured (A, R) and verified (M reply) before a measurement counts as started
 * - M is a toggle: the app checks the reply and flips again when the state went the wrong way
 * - a stale or half-empty frame never reaches the stored measurement
 * - the link loss is reported and any waiting command is rejected
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleProvider, useBle } from '../../contexts/BleContext';
import { commandById } from '../../services/merak/commands';
import { FakeTransport, heartbeat, minFrame, rawFrame, reply, text } from '../helpers/merak';

const setup = () => {
  const fake = new FakeTransport();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BleProvider transport={fake}>{children}</BleProvider>
  );
  const hook = renderHook(() => useBle(), { wrapper });
  return { fake, ...hook };
};

/** Connect and wait until the post-connect initialisation (V, A, R) has finished. */
const connectAndInit = async (ctx: ReturnType<typeof setup>) => {
  await act(async () => {
    await ctx.result.current.connect();
  });
  await waitFor(() => expect(ctx.fake.written).toEqual(['V', 'A0', 'R10']), { timeout: 3000 });
};

const def = (id: string) => {
  const d = commandById(id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('connect()', () => {
  it('connects, shows the device name and initialises the unit (V, then mode and rate)', async () => {
    const ctx = setup();
    await connectAndInit(ctx);

    expect(ctx.result.current.status).toBe('connected');
    expect(ctx.result.current.deviceName).toBe('ESP32bt_MeasLength');
    expect(ctx.result.current.mtu).toBe(247);
    expect(ctx.result.current.error).toBeNull();
    await waitFor(() => expect(ctx.result.current.deviceInfo?.firmware).toBe('3.6.0'));
    expect(ctx.result.current.deviceInfo).toMatchObject({ role: 'MASTER', protocol: 1, devBuild: true });
  });

  it('reports a browser without Bluetooth support', async () => {
    const ctx = setup();
    ctx.fake.supported = false;
    await act(async () => {
      await ctx.result.current.connect();
    });
    expect(ctx.result.current.status).toBe('disconnected');
    expect(ctx.result.current.error).toContain('Web Bluetooth');
  });

  it('reports a failed connection and stays disconnected', async () => {
    const ctx = setup();
    ctx.fake.failConnect = new Error('Měřák nenalezen');
    await act(async () => {
      await ctx.result.current.connect();
    });
    expect(ctx.result.current.status).toBe('disconnected');
    expect(ctx.result.current.error).toBe('Měřák nenalezen');
  });

  it('shows a friendly message when the browser picker is cancelled', async () => {
    const ctx = setup();
    ctx.fake.failConnect = new Error('User cancelled the requestDevice() chooser.');
    await act(async () => {
      await ctx.result.current.connect();
    });
    expect(ctx.result.current.error).toBe('Výběr zařízení byl zrušen.');
  });

  it('writes the persisted mode and rate to the unit after connecting', async () => {
    await AsyncStorage.setItem('merak.mode', 'raw');
    await AsyncStorage.setItem('merak.rate', '25');
    const ctx = setup();
    await waitFor(() => expect(ctx.result.current.mode).toBe('raw'));
    await act(async () => {
      await ctx.result.current.connect();
    });
    await waitFor(() => expect(ctx.fake.written).toEqual(['V', 'A1', 'R25']), { timeout: 3000 });
  });
});

describe('measurement control', () => {
  it('re-sends mode and rate, then starts with M and confirms from the reply', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.written.length = 0;

    let ok = false;
    await act(async () => {
      ok = await ctx.result.current.startMeasurement();
    });

    expect(ok).toBe(true);
    expect(ctx.fake.written).toEqual(['A0', 'R10', 'M']);
    expect(ctx.result.current.measuring).toBe(true);
  });

  it('stops with a second M', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    await act(async () => {
      await ctx.result.current.startMeasurement();
    });
    ctx.fake.written.length = 0;

    let ok = false;
    await act(async () => {
      ok = await ctx.result.current.stopMeasurement();
    });
    expect(ok).toBe(true);
    expect(ctx.fake.written).toEqual(['M']);
    expect(ctx.result.current.measuring).toBe(false);
  });

  it('flips M again when the unit was already measuring (toggle went the wrong way)', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.running = true; // e.g. a previous session left it on
    ctx.fake.written.length = 0;

    let ok = false;
    await act(async () => {
      ok = await ctx.result.current.startMeasurement();
    });
    expect(ok).toBe(true);
    expect(ctx.fake.written).toEqual(['A0', 'R10', 'M', 'M']);
    expect(ctx.result.current.measuring).toBe(true);
  });

  it('does nothing when stopping a measurement that is not running', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.written.length = 0;
    await act(async () => {
      expect(await ctx.result.current.stopMeasurement()).toBe(true);
    });
    expect(ctx.fake.written).toEqual([]);
  });

  it('refuses to start when not connected', async () => {
    const ctx = setup();
    let ok = true;
    await act(async () => {
      ok = await ctx.result.current.startMeasurement();
    });
    expect(ok).toBe(false);
  });

  it('falls back to MIN when the unit refuses RAW (MTU too small)', async () => {
    await AsyncStorage.setItem('merak.mode', 'raw');
    const ctx = setup();
    ctx.fake.responder = (cmd) =>
      cmd === 'A1' ? [reply('A', 3, 0), text('MTU too small for RAW mode')] : undefined;
    await waitFor(() => expect(ctx.result.current.mode).toBe('raw'));
    await act(async () => {
      await ctx.result.current.connect();
    });
    await waitFor(() => expect(ctx.fake.written).toEqual(['V', 'A1', 'A0', 'R10']), { timeout: 3000 });
    expect(ctx.result.current.mode).toBe('min');
    expect(ctx.result.current.error).toContain('RAW');
  });
});

describe('setMode / setRate', () => {
  it('writes the mode to the unit and remembers it', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    let ok = false;
    await act(async () => {
      ok = await ctx.result.current.setMode('raw');
    });
    expect(ok).toBe(true);
    expect(ctx.fake.written[ctx.fake.written.length - 1]).toBe('A1');
    expect(ctx.result.current.mode).toBe('raw');
    expect(await AsyncStorage.getItem('merak.mode')).toBe('raw');
  });

  it('keeps the old mode and shows the reason when the unit refuses', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.responder = (cmd) => (cmd === 'A1' ? [reply('A', 3, 0), text('MTU too small for RAW mode')] : undefined);
    let ok = true;
    await act(async () => {
      ok = await ctx.result.current.setMode('raw');
    });
    expect(ok).toBe(false);
    expect(ctx.result.current.mode).toBe('min');
    expect(ctx.result.current.error).toContain('nelze provést');
  });

  it('stores the preference without a connection', async () => {
    const ctx = setup();
    await act(async () => {
      expect(await ctx.result.current.setMode('raw')).toBe(true);
    });
    expect(ctx.result.current.mode).toBe('raw');
    expect(ctx.fake.written).toEqual([]);
  });

  it('rejects a rate outside 1-100 without writing anything', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.written.length = 0;
    await act(async () => {
      expect(await ctx.result.current.setRate(101)).toBe(false);
      expect(await ctx.result.current.setRate(0)).toBe(false);
    });
    expect(ctx.fake.written).toEqual([]);
    expect(ctx.result.current.rateHz).toBe(10);
  });

  it('writes a valid rate and remembers it', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    await act(async () => {
      expect(await ctx.result.current.setRate(40)).toBe(true);
    });
    expect(ctx.fake.written[ctx.fake.written.length - 1]).toBe('R40');
    expect(ctx.result.current.rateHz).toBe(40);
    expect(await AsyncStorage.getItem('merak.rate')).toBe('40');
  });
});

describe('runCommand()', () => {
  it('sends the catalogue command and syncs the app state (rate)', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    let result;
    await act(async () => {
      result = await ctx.result.current.runCommand(def('rate'), 20);
    });
    expect(result).toMatchObject({ command: 'R', sent: 'R20', status: 0, value: 20, ok: true });
    expect(ctx.result.current.rateHz).toBe(20);
  });

  it('does not send an out-of-range argument', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.written.length = 0;
    await act(async () => {
      await expect(ctx.result.current.runCommand(def('rate'), 500)).rejects.toThrow(RangeError);
    });
    expect(ctx.fake.written).toEqual([]);
  });

  it('collects the text lines of a service command', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.responder = (cmd) =>
      cmd === '!rmt'
        ? [
            reply('!', 0, 3),
            text('RMT 5 s, decode CPU 1.30 %'),
            text('J1 GPIO18: 99 fr/s err 0 ovf 0'),
            text('J2 GPIO40: 101 fr/s err 0 ovf 0'),
          ]
        : undefined;
    let result: { message: string; ok: boolean } | undefined;
    await act(async () => {
      result = await ctx.result.current.runCommand(def('rmt'));
    });
    expect(result?.ok).toBe(true);
    expect(result?.message).toBe(
      'RMT 5 s, decode CPU 1.30 %\nJ1 GPIO18: 99 fr/s err 0 ovf 0\nJ2 GPIO40: 101 fr/s err 0 ovf 0'
    );
  });

  it('returns a failed status instead of throwing (e.g. !tx in a production build)', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.responder = (cmd) =>
      cmd === '!tx' ? [reply('!', 3, 0), text('Service command: serial line or dev build only')] : undefined;
    let result: { ok: boolean; status: number; message: string } | undefined;
    await act(async () => {
      result = await ctx.result.current.runCommand(def('tx'));
    });
    expect(result?.ok).toBe(false);
    expect(result?.status).toBe(3);
    expect(result?.message).toContain('dev build only');
  });

  it('updates the device info after V', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.responder = (cmd) =>
      cmd === 'V'
        ? [reply('V', 0, 2), text('FW 4.0.0 role MASTER protocol 2 SN AABBCCDDEEFF')]
        : undefined;
    await act(async () => {
      await ctx.result.current.runCommand(def('version'));
    });
    expect(ctx.result.current.deviceInfo).toMatchObject({ firmware: '4.0.0', protocol: 2, devBuild: false });
  });

  it('serialises commands: the second is written only after the first was answered', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.written.length = 0;
    await act(async () => {
      await Promise.all([
        ctx.result.current.sendCommand('Q', { collectText: false }),
        ctx.result.current.sendCommand('I', { collectText: false }),
      ]);
    });
    expect(ctx.fake.written).toEqual(['Q', 'I']);
  });

  it('rejects when the unit does not answer in time', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    ctx.fake.responder = () => []; // total silence
    await act(async () => {
      await expect(ctx.result.current.sendCommand('Q', { timeoutMs: 80 })).rejects.toThrow(/neodpověděl/);
    });
  });

  it('rejects when not connected', async () => {
    const ctx = setup();
    await act(async () => {
      await expect(ctx.result.current.sendCommand('V')).rejects.toThrow('není připojený');
    });
  });
});

describe('live data', () => {
  it('reduces the latest frame to left/right distances', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.fake.push(minFrame({ master: 118, slave: 132 })));

    const sides = ctx.result.current.getLatestSides();
    expect(sides).toMatchObject({ left: 118, right: 132 });
    expect(sides?.ageMs).toBeLessThan(500);
  });

  it('swaps the sides when requested', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.result.current.setSwapSides(true));
    act(() => ctx.fake.push(minFrame({ master: 118, slave: 132 })));
    expect(ctx.result.current.getLatestSides()).toMatchObject({ left: 132, right: 118 });
  });

  it('uses the per-unit minimum of a raw frame', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.fake.push(rawFrame({ values: [150, 120, 140, 130, 230, 220, 210, 200] })));
    expect(ctx.result.current.getLatestSides()).toMatchObject({ left: 120, right: 200 });
  });

  it('reports a missing side as null', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.fake.push(minFrame({ slaveValid: false, slave: 0xffff })));
    expect(ctx.result.current.getLatestSides()).toMatchObject({ left: 118, right: null });
  });

  it('returns null when there is no frame yet', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    expect(ctx.result.current.getLatestSides()).toBeNull();
  });

  it('returns null when the newest frame is stale', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.fake.push(minFrame()));
    expect(ctx.result.current.getLatestSides()).not.toBeNull();

    const realNow = Date.now;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 5000);
    try {
      expect(ctx.result.current.getLatestSides()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('feeds the store used by the live monitor', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => {
      ctx.fake.push(heartbeat());
      ctx.fake.push(rawFrame());
    });
    const snap = ctx.result.current.store.getSnapshot();
    expect(snap.frames).toBe(1);
    expect(snap.heartbeats).toBe(1);
    expect(snap.frame?.mode).toBe('raw');
  });
});

describe('link loss', () => {
  it('reports a lost link, stops the measuring state and rejects a waiting command', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    await act(async () => {
      await ctx.result.current.startMeasurement();
    });
    expect(ctx.result.current.measuring).toBe(true);

    ctx.fake.responder = () => []; // the next command never gets an answer
    let waiting: Promise<unknown> | undefined;
    await act(async () => {
      waiting = ctx.result.current.sendCommand('Q', { timeoutMs: 5000 }).catch((e: Error) => e.message);
      await new Promise((resolve) => setTimeout(resolve, 20)); // let the queue write it
    });
    act(() => ctx.fake.drop('GATT 19'));

    expect(await waiting).toBe('Spojení s měřákem bylo ztraceno');
    expect(ctx.result.current.status).toBe('disconnected');
    expect(ctx.result.current.measuring).toBe(false);
    expect(ctx.result.current.error).toContain('GATT 19');
  });

  it('rejects a command that was queued but not yet written when the link dropped', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    let queued: Promise<unknown> | undefined;
    act(() => {
      queued = ctx.result.current.sendCommand('Q').catch((e: Error) => e.message);
      ctx.fake.drop();
    });
    expect(await queued).toBe('Měřák není připojený');
  });

  it('does not report an error for a disconnect the user asked for', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    await act(async () => {
      await ctx.result.current.disconnect();
    });
    expect(ctx.result.current.status).toBe('disconnected');
    expect(ctx.result.current.error).toBeNull();
    expect(ctx.fake.disconnects).toBeGreaterThan(0);
  });

  it('stops a running measurement before disconnecting', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    await act(async () => {
      await ctx.result.current.startMeasurement();
    });
    ctx.fake.written.length = 0;
    await act(async () => {
      await ctx.result.current.disconnect();
    });
    expect(ctx.fake.written).toEqual(['M']);
    expect(ctx.fake.running).toBe(false);
  });

  it('can reconnect after the link was lost', async () => {
    const ctx = setup();
    await connectAndInit(ctx);
    act(() => ctx.fake.drop());
    expect(ctx.result.current.status).toBe('disconnected');

    ctx.fake.written.length = 0;
    await act(async () => {
      await ctx.result.current.connect();
    });
    expect(ctx.result.current.status).toBe('connected');
    await waitFor(() => expect(ctx.fake.written).toEqual(['V', 'A0', 'R10']), { timeout: 3000 });
  });
});

describe('preferences', () => {
  it('defaults to firmware 4.0.0 when nothing was chosen yet', async () => {
    const ctx = setup();
    expect(ctx.result.current.profile).toBe('4.0');
    // a stored choice must not be needed for the default
    await waitFor(() => expect(ctx.result.current.profile).toBe('4.0'));
  });

  it('remembers the firmware profile and the side swap', async () => {
    const ctx = setup();
    act(() => ctx.result.current.setProfile('3.6'));
    act(() => ctx.result.current.setSwapSides(true));
    expect(ctx.result.current.profile).toBe('3.6');
    expect(ctx.result.current.swapSides).toBe(true);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('merak.profile')).toBe('3.6');
      expect(await AsyncStorage.getItem('merak.swapSides')).toBe('1');
    });
  });

  it('restores a stored firmware choice over the default', async () => {
    await AsyncStorage.setItem('merak.profile', '3.6');
    await AsyncStorage.setItem('merak.swapSides', '1');
    const ctx = setup();
    await waitFor(() => expect(ctx.result.current.profile).toBe('3.6'));
    expect(ctx.result.current.swapSides).toBe(true);
  });
});
