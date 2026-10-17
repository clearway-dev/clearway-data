import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '../ui/Card';
import { UIConfig } from '../../config/ui.config';
import { useBle } from '../../contexts/BleContext';
import { useMerakSnapshot } from '../../hooks/useMerakSnapshot';
import type { DataKind, LogKind } from '../../services/merak/merak.store';

interface Props {
  title?: string;
  maxLines?: number;
}

type LineKind = LogKind | DataKind;

interface Line {
  id: number;
  at: number;
  kind: LineKind;
  text: string;
  hex?: string;
  alarm?: boolean;
}

const KIND_MARK: Record<LineKind, string> = {
  tx: '→',
  reply: '←',
  text: ' ',
  event: '•',
  error: '!',
  frame: '◂',
  heartbeat: '*',
  unsupported: '?',
  malformed: '?',
};

// Palette for the dark console background.
const KIND_COLOR: Record<LineKind, string> = {
  tx: '#60a5fa',
  reply: '#4ade80',
  text: '#e2e8f0',
  event: '#94a3b8',
  error: '#f87171',
  frame: '#5eead4',
  heartbeat: '#64748b',
  unsupported: '#fbbf24',
  malformed: '#f87171',
};

const clock = (at: number): string => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const Toggle: React.FC<{ label: string; on: boolean; onPress: () => void; testID: string }> = ({
  label,
  on,
  onPress,
  testID,
}) => (
  <TouchableOpacity
    testID={testID}
    onPress={onPress}
    style={[styles.chip, on && styles.chipOn]}
    accessibilityState={{ selected: on }}
  >
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </TouchableOpacity>
);

/**
 * Console of the communication with the measuring unit, newest line first: commands (→), replies (←),
 * text lines, connection events and errors, plus everything the unit sends - decoded data frames (◂),
 * heartbeats (*) and frames the app cannot parse (?), optionally with their raw hex.
 */
export const MerakLogCard: React.FC<Props> = ({ title = 'Konzole měřáku', maxLines = 60 }) => {
  const { store, status, measuring, startMeasurement, stopMeasurement } = useBle();
  const { snap, now } = useMerakSnapshot(300);
  const [showData, setShowData] = useState(true);
  // On by default like meas_client.py: one line per second shows at once that the link is alive,
  // even before a measurement (and with it the data frames) is started.
  const [showHeartbeat, setShowHeartbeat] = useState(true);
  const [busy, setBusy] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showHex, setShowHex] = useState(false);
  const [paused, setPaused] = useState(false);
  const frozen = useRef<Line[] | null>(null);

  const live = useMemo<Line[]>(() => {
    const events: Line[] = snap.log.map((e) => ({ id: e.id, at: e.at, kind: e.kind, text: e.text }));
    const data: Line[] = snap.dataLog
      .filter((d) => (d.kind === 'heartbeat' ? showHeartbeat : d.kind === 'frame' ? showData : true))
      .map((d) => ({ id: d.id, at: d.at, kind: d.kind, text: d.text, hex: d.hex, alarm: d.alarm }));
    // ids come from one counter in the store, so sorting by id keeps the arrival order
    return [...events, ...data].sort((a, b) => a.id - b.id).slice(-maxLines).reverse();
  }, [snap, showData, showHeartbeat, maxLines]);

  const toggleStream = async () => {
    setBusy(true);
    setStreamError(null);
    try {
      const ok = measuring ? await stopMeasurement() : await startMeasurement();
      if (!ok) setStreamError('Měřák nepotvrdil požadovaný stav měření.');
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lastFrameAgo = snap.frameAt ? Math.max(0, now - snap.frameAt) : null;
  const connected = status === 'connected';

  if (paused && frozen.current === null) frozen.current = live;
  if (!paused) frozen.current = null;
  const lines = paused && frozen.current ? frozen.current : live;

  return (
    <Card style={styles.card} testID="merakLogCard">
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={() => store.clearLog()} testID="merakLogClear">
          <Text style={styles.clear}>Vymazat</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        Nejnovější nahoře · rámců {snap.frames} · {snap.fps.toFixed(1)} /s
        {paused ? ' · POZASTAVENO' : ''}
      </Text>

      <View style={styles.liveRow} testID="consoleLive">
        <Text
          style={[styles.liveText, connected && measuring ? styles.liveOn : connected ? styles.liveIdle : styles.liveOff]}
          testID="consoleLiveText"
        >
          {!connected
            ? '○ Měřák není připojený'
            : measuring
              ? `● ŽIVĚ · ${snap.fps.toFixed(1)} rámců/s · poslední ${
                  lastFrameAgo === null ? '—' : lastFrameAgo < 1000 ? `před ${lastFrameAgo} ms` : `před ${(lastFrameAgo / 1000).toFixed(1)} s`
                }`
              : '○ Měření neběží, chodí jen heartbeat'}
        </Text>
        {connected && (
          <TouchableOpacity
            testID={measuring ? 'consoleStop' : 'consoleStart'}
            style={[styles.liveButton, measuring && styles.liveButtonStop, busy && styles.liveButtonBusy]}
            onPress={() => {
              void toggleStream();
            }}
            disabled={busy}
          >
            <Text style={styles.liveButtonText}>{busy ? '…' : measuring ? '■ Zastavit' : '▶ Spustit měření'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {streamError ? (
        <Text style={styles.liveError} testID="consoleStreamError">
          {streamError}
        </Text>
      ) : null}

      <View style={styles.chips}>
        <Toggle label="Data" on={showData} onPress={() => setShowData((v) => !v)} testID="consoleToggleData" />
        <Toggle
          label="Heartbeat"
          on={showHeartbeat}
          onPress={() => setShowHeartbeat((v) => !v)}
          testID="consoleToggleHeartbeat"
        />
        <Toggle label="Hex" on={showHex} onPress={() => setShowHex((v) => !v)} testID="consoleToggleHex" />
        <Toggle
          label={paused ? 'Pokračovat' : 'Pozastavit'}
          on={paused}
          onPress={() => setPaused((v) => !v)}
          testID="consolePause"
        />
      </View>

      <View style={styles.console} testID="merakConsole">
        {lines.length === 0 ? (
          <Text style={styles.empty}>
            {connected ? 'Zatím nic. Datové rámce chodí, jen když běží měření.' : 'Připojte měřák na stránce Nastavit měření.'}
          </Text>
        ) : (
          lines.map((line) => (
            <View key={line.id} testID={`console-${line.kind}`}>
              <Text
                style={[styles.line, { color: KIND_COLOR[line.kind] }, line.alarm && styles.alarm]}
                selectable
              >
                {clock(line.at)} {KIND_MARK[line.kind]} {line.text}
              </Text>
              {(showHex || line.kind === 'unsupported' || line.kind === 'malformed') && line.hex ? (
                <Text style={styles.hex} selectable testID="console-hex">
                  {'              '}
                  {line.hex}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </Card>
  );
};

const mono = { fontFamily: 'monospace' } as const;

const styles = StyleSheet.create({
  card: {
    marginBottom: UIConfig.spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
  },
  subtitle: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginTop: 2,
    marginBottom: UIConfig.spacing.sm,
  },
  clear: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.primary,
    fontWeight: '600',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: UIConfig.spacing.sm,
    marginBottom: UIConfig.spacing.sm,
  },
  liveText: {
    flex: 1,
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
  },
  liveOn: {
    color: UIConfig.colors.success,
  },
  liveIdle: {
    color: UIConfig.colors.warningForeground,
  },
  liveOff: {
    color: UIConfig.colors.mutedForeground,
  },
  liveButton: {
    paddingHorizontal: UIConfig.spacing.md,
    paddingVertical: UIConfig.spacing.sm,
    borderRadius: UIConfig.borderRadius.md,
    backgroundColor: UIConfig.colors.success,
  },
  liveButtonStop: {
    backgroundColor: UIConfig.colors.destructive,
  },
  liveButtonBusy: {
    opacity: 0.6,
  },
  liveButtonText: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
    color: '#ffffff',
  },
  liveError: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.destructive,
    marginBottom: UIConfig.spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: UIConfig.spacing.sm,
    marginBottom: UIConfig.spacing.sm,
  },
  chip: {
    paddingHorizontal: UIConfig.spacing.md,
    paddingVertical: 6,
    borderRadius: UIConfig.borderRadius.xl,
    borderWidth: 1,
    borderColor: UIConfig.colors.input,
    backgroundColor: UIConfig.colors.muted,
  },
  chipOn: {
    backgroundColor: UIConfig.colors.foreground,
    borderColor: UIConfig.colors.foreground,
  },
  chipText: {
    fontSize: UIConfig.fontSize.xs,
    fontWeight: '600',
    color: UIConfig.colors.foreground,
  },
  chipTextOn: {
    color: '#ffffff',
  },
  console: {
    backgroundColor: '#0b1220',
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.sm,
  },
  empty: {
    fontSize: UIConfig.fontSize.xs,
    color: '#94a3b8',
    ...mono,
  },
  line: {
    fontSize: UIConfig.fontSize.xs,
    marginBottom: 2,
    ...mono,
  },
  alarm: {
    color: '#f87171',
    fontWeight: '700',
  },
  hex: {
    fontSize: 10,
    color: '#64748b',
    marginBottom: 3,
    ...mono,
  },
});
