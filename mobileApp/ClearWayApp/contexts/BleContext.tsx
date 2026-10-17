import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MerakConfig } from '../config/merak.config';
import {
  CommandDef,
  DeviceInfo,
  FwProfile,
  buildCommand,
  parseVersionText,
  profileInfo,
} from '../services/merak/commands';
import { MerakStore } from '../services/merak/merak.store';
import { MerakFrame, MerakMode, Sides, encodeAscii, replyStatusLabel, sidesFromFrame } from '../services/merak/protocol';
import { createTransport } from '../services/merak/transport';
import type { MerakTransport } from '../services/merak/transport.types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface CommandResult {
  /** Command letter the device answered ('!' for all service commands). */
  command: string;
  /** The text that was written, e.g. "R10". */
  sent: string;
  status: number;
  statusLabel: string;
  value: number;
  /** Text lines of the reply joined with newlines (empty when text replies are off). */
  message: string;
  durationMs: number;
  ok: boolean;
}

export interface SendOptions {
  timeoutMs?: number;
  /** Wait for the text lines that follow the machine reply (default true). */
  collectText?: boolean;
}

export interface LatestSides extends Sides {
  ageMs: number;
  frame: MerakFrame;
}

export interface BleContextValue {
  /** false e.g. in a browser without Web Bluetooth. */
  supported: boolean;
  status: ConnectionStatus;
  deviceName: string | null;
  mtu: number | null;
  error: string | null;
  /** Heartbeat or data arrived within HEARTBEAT_LOST_MS. */
  linkOk: boolean;
  mode: MerakMode;
  rateHz: number;
  /** false (default): master = left, slave = right. */
  swapSides: boolean;
  profile: FwProfile;
  deviceInfo: DeviceInfo | null;
  /** Measurement is running on the device (confirmed by the reply to M). */
  measuring: boolean;
  /** Live data, counters and event log; poll it with useMerakSnapshot. */
  store: MerakStore;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setMode: (mode: MerakMode) => Promise<boolean>;
  setRate: (hz: number) => Promise<boolean>;
  setSwapSides: (swap: boolean) => void;
  setProfile: (profile: FwProfile) => void;
  /** Low level: write a command and wait for its machine reply (and text lines). */
  sendCommand: (text: string, options?: SendOptions) => Promise<CommandResult>;
  /** Validate the argument, build the ASCII command from the catalogue and send it. */
  runCommand: (def: CommandDef, arg?: number) => Promise<CommandResult>;
  startMeasurement: () => Promise<boolean>;
  stopMeasurement: () => Promise<boolean>;
  /** Newest distances reduced to left/right, null when the data is missing or stale. */
  getLatestSides: () => LatestSides | null;
}

const KEYS = {
  mode: 'merak.mode',
  rate: 'merak.rate',
  swap: 'merak.swapSides',
  profile: 'merak.profile',
} as const;

const NOT_PROVIDED = 'BleProvider chybí';
/** Firmware generation used until the user picks another one (and it is remembered). */
export const DEFAULT_PROFILE: FwProfile = '4.0';
const defaultStore = new MerakStore();

/** Used when a component renders without BleProvider (tests, storybook): always disconnected. */
const defaultValue: BleContextValue = {
  supported: false,
  status: 'disconnected',
  deviceName: null,
  mtu: null,
  error: null,
  linkOk: false,
  mode: 'min',
  rateHz: MerakConfig.DEFAULT_RATE_HZ,
  swapSides: false,
  profile: DEFAULT_PROFILE,
  deviceInfo: null,
  measuring: false,
  store: defaultStore,
  connect: async () => {},
  disconnect: async () => {},
  setMode: async () => false,
  setRate: async () => false,
  setSwapSides: () => {},
  setProfile: () => {},
  sendCommand: async () => {
    throw new Error(NOT_PROVIDED);
  },
  runCommand: async () => {
    throw new Error(NOT_PROVIDED);
  },
  startMeasurement: async () => false,
  stopMeasurement: async () => false,
  getLatestSides: () => null,
};

const BleContext = createContext<BleContextValue>(defaultValue);

export const useBle = (): BleContextValue => useContext(BleContext);

interface Pending {
  letter: string;
  sent: string;
  startedAt: number;
  waitForText: boolean;
  lines: string[];
  reply: { status: number; value: number } | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const savePref = async (key: string, value: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // preferences are a convenience only
  }
};

interface ProviderProps {
  children: React.ReactNode;
  /** Injected in tests; defaults to the platform transport (native BLE or Web Bluetooth). */
  transport?: MerakTransport;
}

export const BleProvider: React.FC<ProviderProps> = ({ children, transport }) => {
  // Created once; the native BleManager itself is only constructed on the first connect().
  const [transportInstance] = useState<MerakTransport>(() => transport ?? createTransport());
  const transportRef = useRef<MerakTransport>(transportInstance);
  const storeRef = useRef<MerakStore>(new MerakStore());
  const store = storeRef.current;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [mtu, setMtu] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOk, setLinkOk] = useState(false);
  const [mode, setModeState] = useState<MerakMode>('min');
  const [rateHz, setRateState] = useState<number>(MerakConfig.DEFAULT_RATE_HZ);
  const [swapSides, setSwapState] = useState(false);
  const [profile, setProfileState] = useState<FwProfile>(DEFAULT_PROFILE);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [measuring, setMeasuring] = useState(false);

  // Mirrors for callbacks that must keep a stable identity (transport handlers, hooks of screens).
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const modeRef = useRef<MerakMode>('min');
  const rateRef = useRef<number>(MerakConfig.DEFAULT_RATE_HZ);
  const swapRef = useRef(false);
  const linkOkRef = useRef(false);
  const measuringRef = useRef(false);
  const userDisconnectRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateStatus = (s: ConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
  };
  const updateLink = (ok: boolean) => {
    if (linkOkRef.current === ok) return;
    linkOkRef.current = ok;
    setLinkOk(ok);
  };
  const updateMeasuring = (on: boolean) => {
    measuringRef.current = on;
    setMeasuring(on);
  };
  const updateMode = (m: MerakMode) => {
    modeRef.current = m;
    setModeState(m);
  };

  // ── persisted preferences ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, r, s, p] = await Promise.all([
          AsyncStorage.getItem(KEYS.mode),
          AsyncStorage.getItem(KEYS.rate),
          AsyncStorage.getItem(KEYS.swap),
          AsyncStorage.getItem(KEYS.profile),
        ]);
        if (cancelled) return;
        if (m === 'min' || m === 'raw') updateMode(m);
        const rate = Number(r);
        if (r && Number.isInteger(rate) && rate >= MerakConfig.RATE_MIN_HZ && rate <= MerakConfig.RATE_MAX_HZ) {
          rateRef.current = rate;
          setRateState(rate);
        }
        if (s === '1' || s === '0') {
          swapRef.current = s === '1';
          setSwapState(s === '1');
        }
        if (p === '3.6' || p === '4.0') setProfileState(p);
      } catch {
        // defaults are fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── command queue ──────────────────────────────────────────────────────────
  const clearPendingTimers = (p: Pending) => {
    if (p.timeoutTimer) clearTimeout(p.timeoutTimer);
    if (p.quietTimer) clearTimeout(p.quietTimer);
    p.timeoutTimer = null;
    p.quietTimer = null;
  };

  const finishPending = () => {
    const p = pendingRef.current;
    if (!p || !p.reply) return;
    clearPendingTimers(p);
    pendingRef.current = null;
    p.resolve({
      command: p.letter,
      sent: p.sent,
      status: p.reply.status,
      statusLabel: replyStatusLabel(p.reply.status),
      value: p.reply.value,
      message: p.lines.join('\n'),
      durationMs: Date.now() - p.startedAt,
      ok: p.reply.status === 0,
    });
  };

  const rejectPending = (e: Error) => {
    const p = pendingRef.current;
    if (!p) return;
    clearPendingTimers(p);
    pendingRef.current = null;
    p.reject(e);
  };

  const dispatch = (text: string, options: SendOptions): Promise<CommandResult> =>
    new Promise<CommandResult>((resolve, reject) => {
      if (statusRef.current !== 'connected') {
        reject(new Error('Měřák není připojený'));
        return;
      }
      const timeoutMs = options.timeoutMs ?? MerakConfig.COMMAND_TIMEOUT_MS;
      const pending: Pending = {
        letter: text.charAt(0),
        sent: text,
        startedAt: Date.now(),
        waitForText: options.collectText !== false,
        lines: [],
        reply: null,
        timeoutTimer: null,
        quietTimer: null,
        resolve,
        reject,
      };
      pending.timeoutTimer = setTimeout(() => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        clearPendingTimers(pending);
        store.addLog('error', `Příkaz ${text}: bez odpovědi do ${Math.round(timeoutMs / 1000)} s`);
        reject(new Error(`Měřák neodpověděl na příkaz ${text} do ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      pendingRef.current = pending;
      store.addLog('tx', text);
      transportRef.current.write(encodeAscii(text)).catch((e: unknown) => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        clearPendingTimers(pending);
        store.addLog('error', `Zápis ${text} selhal: ${errorMessage(e)}`);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });

  /** One command at a time: the firmware answers with a single machine reply per command. */
  const sendCommand = useCallback((text: string, options: SendOptions = {}): Promise<CommandResult> => {
    const run = () => dispatch(text, options);
    const next = chainRef.current.then(run, run);
    chainRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── incoming data ──────────────────────────────────────────────────────────
  const handleData = useCallback((bytes: Uint8Array) => {
    const msg = store.ingest(bytes);
    updateLink(true); // any traffic proves the link, the watchdog only reacts to silence

    switch (msg.type) {
      case 'reply': {
        store.addLog('reply', `${msg.command}: ${replyStatusLabel(msg.status)}, hodnota ${msg.value}`);
        const p = pendingRef.current;
        if (p && !p.reply && msg.command === p.letter) {
          p.reply = { status: msg.status, value: msg.value };
          if (p.waitForText) {
            if (p.quietTimer) clearTimeout(p.quietTimer);
            p.quietTimer = setTimeout(finishPending, MerakConfig.TEXT_QUIET_MS);
          } else {
            finishPending();
          }
        }
        break;
      }
      case 'text': {
        store.addLog('text', msg.text);
        const p = pendingRef.current;
        if (p) {
          p.lines.push(msg.text);
          if (p.reply && p.quietTimer) {
            clearTimeout(p.quietTimer);
            p.quietTimer = setTimeout(finishPending, MerakConfig.TEXT_QUIET_MS);
          }
        }
        break;
      }
      case 'unsupported':
        if (store.getSnapshot().unsupported === 1) {
          store.addLog(
            'error',
            `Rámec s protokolem ${msg.protocol} (${msg.length} B) nemá v aplikaci parser, zobrazuje se jen hex`
          );
        }
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopWatchdog = () => {
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = null;
  };

  const startWatchdog = () => {
    stopWatchdog();
    watchdogRef.current = setInterval(() => {
      const silent = Date.now() - store.heartbeatTime() >= MerakConfig.HEARTBEAT_LOST_MS;
      if (silent && linkOkRef.current) {
        store.addLog('error', 'Heartbeat nepřišel do 3 s, spojení je pravděpodobně přerušené');
      }
      updateLink(!silent);
    }, 1000);
  };

  const handleDisconnect = useCallback((reason?: string) => {
    if (statusRef.current === 'disconnected') return;
    stopWatchdog();
    rejectPending(new Error('Spojení s měřákem bylo ztraceno'));
    updateMeasuring(false);
    updateLink(false);
    updateStatus('disconnected');
    if (!userDisconnectRef.current) {
      setError(`Spojení s měřákem bylo ztraceno${reason ? ` (${reason})` : ''}`);
    }
    store.addLog('event', userDisconnectRef.current ? 'Odpojeno' : `Spojení ztraceno${reason ? `: ${reason}` : ''}`);
    userDisconnectRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── device configuration ───────────────────────────────────────────────────
  /**
   * The protocol has no getter for mode and rate, so both are written again before every
   * measurement (FW README, "Chování, které specifikace neřeší").
   */
  const applyConfig = useCallback(async () => {
    const wantRaw = modeRef.current === 'raw';
    const a = await sendCommand(wantRaw ? 'A1' : 'A0', { collectText: false });
    if (!a.ok && wantRaw) {
      store.addLog('error', 'Měřák odmítl RAW mód (nízké MTU), přepínám na MIN');
      await sendCommand('A0', { collectText: false });
      updateMode('min');
      setError('Měřák odmítl RAW mód (nízké MTU), používá se MIN.');
    }
    await sendCommand(`R${rateRef.current}`, { collectText: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCommand]);

  const initDevice = useCallback(async () => {
    try {
      const v = await sendCommand('V');
      const info = parseVersionText(v.message);
      if (info) {
        setDeviceInfo(info);
        store.addLog('event', `Firmware ${info.firmware}, protokol ${info.protocol}, SN ${info.serial}${info.devBuild ? ', vývojový build' : ''}`);
      }
      await applyConfig();
    } catch (e) {
      store.addLog('error', `Inicializace měřáku selhala: ${errorMessage(e)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCommand, applyConfig]);

  // ── public API ─────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (statusRef.current !== 'disconnected') return;
    const transport = transportRef.current;
    if (!transport.isSupported()) {
      setError('Tento prohlížeč nepodporuje Web Bluetooth. Použijte Chrome nebo Edge.');
      return;
    }
    setError(null);
    setDeviceInfo(null);
    userDisconnectRef.current = false;
    store.resetData();
    updateStatus('connecting');
    try {
      const info = await transport.connect({ onData: handleData, onDisconnect: handleDisconnect });
      setDeviceName(info.name);
      setMtu(info.mtu ?? null);
      store.addLog('event', `Připojeno: ${info.name}${info.mtu ? `, MTU ${info.mtu}` : ''}`);
      updateLink(true);
      updateStatus('connected');
      startWatchdog();
      void initDevice();
    } catch (e) {
      const msg = errorMessage(e);
      updateStatus('disconnected');
      updateLink(false);
      setError(/cancel|chooser/i.test(msg) ? 'Výběr zařízení byl zrušen.' : msg);
      store.addLog('error', `Připojení selhalo: ${msg}`);
      try {
        await transport.disconnect();
      } catch {
        // nothing to clean up
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleData, handleDisconnect, initDevice]);

  const setMeasuringOnDevice = useCallback(
    async (on: boolean): Promise<boolean> => {
      // M is a toggle: check the state in the reply and flip once more if it went the wrong way.
      let r = await sendCommand('M', { collectText: false });
      if (!r.ok) throw new Error(`Příkaz M: ${r.statusLabel}`);
      if ((r.value === 1) !== on) {
        r = await sendCommand('M', { collectText: false });
        if (!r.ok) throw new Error(`Příkaz M: ${r.statusLabel}`);
      }
      const running = r.value === 1;
      updateMeasuring(running);
      return running === on;
    },
    [sendCommand]
  );

  const startMeasurement = useCallback(async (): Promise<boolean> => {
    if (statusRef.current !== 'connected') return false;
    await applyConfig();
    return setMeasuringOnDevice(true);
  }, [applyConfig, setMeasuringOnDevice]);

  const stopMeasurement = useCallback(async (): Promise<boolean> => {
    if (statusRef.current !== 'connected' || !measuringRef.current) return true;
    return setMeasuringOnDevice(false);
  }, [setMeasuringOnDevice]);

  const disconnect = useCallback(async () => {
    if (statusRef.current === 'disconnected') return;
    userDisconnectRef.current = true;
    try {
      await stopMeasurement();
    } catch {
      // the device stops measuring by itself when the link drops
    }
    try {
      await transportRef.current.disconnect();
    } catch {
      // already gone
    }
    handleDisconnect();
  }, [stopMeasurement, handleDisconnect]);

  const setMode = useCallback(
    async (next: MerakMode): Promise<boolean> => {
      if (statusRef.current === 'connected') {
        try {
          const r = await sendCommand(next === 'raw' ? 'A1' : 'A0');
          if (!r.ok) {
            setError(`Přepnutí módu: ${r.statusLabel}${r.message ? ` (${r.message})` : ''}`);
            return false;
          }
        } catch (e) {
          setError(errorMessage(e));
          return false;
        }
      }
      setError(null);
      updateMode(next);
      void savePref(KEYS.mode, next);
      return true;
    },
    [sendCommand]
  );

  const setRate = useCallback(
    async (hz: number): Promise<boolean> => {
      if (!Number.isInteger(hz) || hz < MerakConfig.RATE_MIN_HZ || hz > MerakConfig.RATE_MAX_HZ) {
        setError(`Frekvence musí být ${MerakConfig.RATE_MIN_HZ} až ${MerakConfig.RATE_MAX_HZ} Hz`);
        return false;
      }
      if (statusRef.current === 'connected') {
        try {
          const r = await sendCommand(`R${hz}`);
          if (!r.ok) {
            setError(`Nastavení frekvence: ${r.statusLabel}`);
            return false;
          }
        } catch (e) {
          setError(errorMessage(e));
          return false;
        }
      }
      setError(null);
      rateRef.current = hz;
      setRateState(hz);
      void savePref(KEYS.rate, String(hz));
      return true;
    },
    [sendCommand]
  );

  const setSwapSides = useCallback((swap: boolean) => {
    swapRef.current = swap;
    setSwapState(swap);
    void savePref(KEYS.swap, swap ? '1' : '0');
  }, []);

  const setProfile = useCallback((next: FwProfile) => {
    setProfileState(next);
    void savePref(KEYS.profile, next);
  }, []);

  /** Keep the app state in step with what the device just confirmed. */
  const applyCommandEffects = (def: CommandDef, arg: number | undefined, result: CommandResult) => {
    switch (def.id) {
      case 'mode-min':
      case 'mode-raw': {
        const next: MerakMode = def.id === 'mode-raw' ? 'raw' : 'min';
        updateMode(next);
        void savePref(KEYS.mode, next);
        break;
      }
      case 'rate':
        if (arg !== undefined) {
          rateRef.current = arg;
          setRateState(arg);
          void savePref(KEYS.rate, String(arg));
        }
        break;
      case 'version': {
        const info = parseVersionText(result.message);
        if (info) setDeviceInfo(info);
        break;
      }
      default:
        break;
    }
  };

  const runCommand = useCallback(
    (def: CommandDef, arg?: number): Promise<CommandResult> => {
      let text: string;
      try {
        text = buildCommand(def, arg);
      } catch (e) {
        return Promise.reject(e);
      }
      return sendCommand(text, {
        timeoutMs: def.longRunning ? MerakConfig.SERVICE_COMMAND_TIMEOUT_MS : MerakConfig.COMMAND_TIMEOUT_MS,
      }).then((result) => {
        if (result.ok) applyCommandEffects(def, arg, result);
        return result;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [sendCommand]
  );

  const getLatestSides = useCallback((): LatestSides | null => {
    const { frame, at } = store.latest();
    if (!frame || !linkOkRef.current) return null;
    const ageMs = Date.now() - at;
    if (ageMs > MerakConfig.DATA_STALE_MS) return null;
    return { ...sidesFromFrame(frame, swapRef.current), ageMs, frame };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the link when the provider goes away (logout, app teardown).
  useEffect(() => {
    const transportAtMount = transportRef.current;
    return () => {
      stopWatchdog();
      void transportAtMount.disconnect().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<BleContextValue>(
    () => ({
      supported: transportRef.current.isSupported(),
      status,
      deviceName,
      mtu,
      error,
      linkOk,
      mode,
      rateHz,
      swapSides,
      profile,
      deviceInfo,
      measuring,
      store,
      connect,
      disconnect,
      setMode,
      setRate,
      setSwapSides,
      setProfile,
      sendCommand,
      runCommand,
      startMeasurement,
      stopMeasurement,
      getLatestSides,
    }),
    [
      status,
      deviceName,
      mtu,
      error,
      linkOk,
      mode,
      rateHz,
      swapSides,
      profile,
      deviceInfo,
      measuring,
      store,
      connect,
      disconnect,
      setMode,
      setRate,
      setSwapSides,
      setProfile,
      sendCommand,
      runCommand,
      startMeasurement,
      stopMeasurement,
      getLatestSides,
    ]
  );

  return <BleContext.Provider value={value}>{children}</BleContext.Provider>;
};

/** Protocol version the selected firmware profile expects in the data frames. */
export const expectedProtocol = (profile: FwProfile): number => profileInfo(profile).protocol;
