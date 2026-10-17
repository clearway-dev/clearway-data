/**
 * Mutable store for everything the measuring unit sends: latest frame, counters, frames per
 * second, an event log (commands, replies, connection) and a separate log of the incoming data.
 *
 * It lives outside React state on purpose: at 10-100 frames per second a context update would
 * re-render every consumer. UI components poll `getSnapshot()` at a low rate instead
 * (see hooks/useMerakSnapshot).
 *
 * The data log is a separate ring buffer, so the stream of frames never pushes the commands and
 * their replies out of the event log.
 */
import { MerakConfig } from '../../config/merak.config';
import { formatFrame, isAlarm } from './format';
import { MerakFrame, MerakMessage, parseNotification, toHex } from './protocol';

export type LogKind = 'tx' | 'reply' | 'text' | 'event' | 'error';

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  text: string;
}

/** One incoming notification that is not a command reply. */
export type DataKind = 'frame' | 'heartbeat' | 'unsupported' | 'malformed';

export interface DataEntry {
  id: number;
  at: number;
  kind: DataKind;
  /** Decoded form (frames) or a short description. */
  text: string;
  hex: string;
  /** A unit reports "too close"; the console highlights it. */
  alarm: boolean;
}

export interface UnsupportedInfo {
  protocol: number;
  length: number;
  hex: string;
  at: number;
}

export interface StoreSnapshot {
  version: number;
  frame: MerakFrame | null;
  frameAt: number;
  /** Hex of the last data notification (parsed or not), for protocol debugging. */
  lastHex: string;
  lastUnsupported: UnsupportedInfo | null;
  heartbeatAt: number;
  frames: number;
  heartbeats: number;
  replies: number;
  unsupported: number;
  malformed: number;
  /** Frames per second measured over the last FPS_WINDOW frames, 0 when nothing arrived recently. */
  fps: number;
  log: LogEntry[];
  dataLog: DataEntry[];
}

export class MerakStore {
  private version = 0;
  private frame: MerakFrame | null = null;
  private frameAt = 0;
  private lastHex = '';
  private lastUnsupported: UnsupportedInfo | null = null;
  private heartbeatAt = 0;
  private frames = 0;
  private heartbeats = 0;
  private replies = 0;
  private unsupported = 0;
  private malformed = 0;
  private arrivals: number[] = [];
  private log: LogEntry[] = [];
  private dataLog: DataEntry[] = [];
  private nextId = 0;
  private cached: StoreSnapshot | null = null;
  private cachedAt = 0;

  private touch(): void {
    this.version += 1;
    this.cached = null;
  }

  private pushData(kind: DataKind, text: string, hex: string, now: number, alarm = false): void {
    this.nextId += 1;
    this.dataLog.push({ id: this.nextId, at: now, kind, text, hex, alarm });
    if (this.dataLog.length > MerakConfig.DATA_LOG_SIZE) {
      this.dataLog.splice(0, this.dataLog.length - MerakConfig.DATA_LOG_SIZE);
    }
  }

  /** Parse one DATA notification, update the counters and return the parsed message. */
  ingest(bytes: Uint8Array, now: number = Date.now()): MerakMessage {
    const msg = parseNotification(bytes);
    const hex = toHex(bytes);
    switch (msg.type) {
      case 'heartbeat':
        this.heartbeatAt = now;
        this.heartbeats += 1;
        this.pushData('heartbeat', 'heartbeat', hex, now);
        break;
      case 'frame':
        this.frame = msg.frame;
        this.frameAt = now;
        this.heartbeatAt = now; // data proves the link just like a heartbeat does
        this.frames += 1;
        this.lastHex = hex;
        this.arrivals.push(now);
        if (this.arrivals.length > MerakConfig.FPS_WINDOW) this.arrivals.shift();
        this.pushData('frame', formatFrame(msg.frame), hex, now, isAlarm(msg.frame));
        break;
      case 'reply':
        this.replies += 1;
        this.heartbeatAt = now;
        break;
      case 'text':
        this.heartbeatAt = now;
        break;
      case 'unsupported':
        this.unsupported += 1;
        this.heartbeatAt = now;
        this.lastHex = hex;
        this.lastUnsupported = { protocol: msg.protocol, length: msg.length, hex, at: now };
        this.pushData('unsupported', `rámec protokolu ${msg.protocol} (${msg.length} B) bez parseru`, hex, now);
        break;
      case 'unknown':
        this.malformed += 1;
        this.addLog('error', `${msg.reason}: ${hex}`, now);
        this.pushData('malformed', msg.reason, hex, now);
        break;
    }
    this.touch();
    return msg;
  }

  addLog(kind: LogKind, text: string, now: number = Date.now()): void {
    this.nextId += 1;
    this.log.push({ id: this.nextId, at: now, kind, text });
    if (this.log.length > MerakConfig.LOG_SIZE) this.log.splice(0, this.log.length - MerakConfig.LOG_SIZE);
    this.touch();
  }

  /** Newest frame and when it arrived; used by the measurement hook. */
  latest(): { frame: MerakFrame | null; at: number } {
    return { frame: this.frame, at: this.frameAt };
  }

  heartbeatTime(): number {
    return this.heartbeatAt;
  }

  /** Called when a connection is (re)established. Keeps the logs, drops stale data. */
  resetData(now: number = Date.now()): void {
    this.frame = null;
    this.frameAt = 0;
    this.lastHex = '';
    this.lastUnsupported = null;
    this.arrivals = [];
    this.heartbeatAt = now;
    this.touch();
  }

  /** Empties both the event log and the data log. */
  clearLog(): void {
    this.log = [];
    this.dataLog = [];
    this.touch();
  }

  getSnapshot(now: number = Date.now()): StoreSnapshot {
    // fps depends on the clock, so the cache also expires with time (frames may stop arriving)
    if (this.cached && now - this.cachedAt < 500) return this.cached;
    let fps = 0;
    const n = this.arrivals.length;
    if (n >= 2 && now - this.arrivals[n - 1] < 2000) {
      const span = this.arrivals[n - 1] - this.arrivals[0];
      if (span > 0) fps = ((n - 1) * 1000) / span;
    }
    this.cached = {
      version: this.version,
      frame: this.frame,
      frameAt: this.frameAt,
      lastHex: this.lastHex,
      lastUnsupported: this.lastUnsupported,
      heartbeatAt: this.heartbeatAt,
      frames: this.frames,
      heartbeats: this.heartbeats,
      replies: this.replies,
      unsupported: this.unsupported,
      malformed: this.malformed,
      fps,
      log: this.log.slice(),
      dataLog: this.dataLog.slice(),
    };
    this.cachedAt = now;
    return this.cached;
  }
}
