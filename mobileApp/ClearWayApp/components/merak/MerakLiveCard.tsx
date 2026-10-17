import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '../ui/Card';
import { UIConfig } from '../../config/ui.config';
import { useBle } from '../../contexts/BleContext';
import { useMerakSnapshot } from '../../hooks/useMerakSnapshot';
import { profileInfo } from '../../services/merak/commands';
import { unitText } from '../../services/merak/format';
import { MerakFrame, SENSORS_PER_UNIT, SensorState, UnitReading } from '../../services/merak/protocol';
import { STATE_LABEL } from '../../services/merak/storage-policy';

interface Props {
  /** Title of the card. */
  title?: string;
}

const formatMs = (ms: number): string => {
  const total = Math.floor(ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

const ago = (now: number, at: number): string => {
  if (!at) return '—';
  const ms = Math.max(0, now - at);
  return ms < 1000 ? `před ${ms} ms` : `před ${(ms / 1000).toFixed(1)} s`;
};

interface UnitColumnProps {
  title: string;
  prefix: 'J' | 'S';
  values: (number | null)[];
  states: SensorState[] | null;
  unit: UnitReading;
  mode: MerakFrame['mode'];
  testID: string;
}

const closeSensorText = (unit: string, prefix: 'J' | 'S', reading: UnitReading): string =>
  reading.index !== null ? `${unit} ${prefix}${reading.index + 1}` : unit;

const stateStyle = (state: SensorState) =>
  state === 'tooClose' ? styles.stateClose : state === 'fault' ? styles.stateFault : styles.stateNoTarget;

const UnitColumn: React.FC<UnitColumnProps> = ({ title, prefix, values, states, unit, mode, testID }) => (
  <View style={styles.unit} testID={testID}>
    <Text style={styles.unitTitle}>{title}</Text>
    {mode === 'raw' && states ? (
      values.slice(0, SENSORS_PER_UNIT).map((v, i) => {
        const state = states[i];
        const isMin = state === 'ok' && unit.state === 'ok' && i === unit.index;
        const isCloseSensor = state === 'tooClose';
        return (
          <View
            key={i}
            style={[styles.sensorRow, isMin && styles.sensorRowMin, isCloseSensor && styles.sensorRowClose]}
            testID={`${testID}-${i}`}
          >
            <Text style={styles.sensorName}>
              {prefix}
              {i + 1}
            </Text>
            {state === 'ok' && v !== null ? (
              <Text style={styles.sensorValue}>{`${v} cm`}</Text>
            ) : (
              <Text style={[styles.sensorState, stateStyle(state)]} testID={`${testID}-${i}-state`}>
                {STATE_LABEL[state]}
              </Text>
            )}
          </View>
        );
      })
    ) : (
      <View
        style={[styles.sensorRow, unit.state === 'ok' && styles.sensorRowMin, unit.state === 'tooClose' && styles.sensorRowClose]}
        testID={`${testID}-min`}
      >
        <Text style={styles.sensorName}>min</Text>
        {unit.state === 'ok' ? (
          <Text style={styles.sensorValue}>{`${unit.min} cm`}</Text>
        ) : (
          <Text style={[styles.sensorState, stateStyle(unit.state)]}>{STATE_LABEL[unit.state]}</Text>
        )}
      </View>
    )}
    <Text style={[styles.unitMin, unit.state === 'tooClose' && styles.stateClose]} testID={`${testID}-unit`}>
      Jednotka: {unitText(unit, prefix)}
    </Text>
  </View>
);

const Row: React.FC<{ label: string; value: string; testID?: string; warn?: boolean }> = ({
  label,
  value,
  testID,
  warn,
}) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, warn && styles.warnText]} testID={testID}>
      {value}
    </Text>
  </View>
);

/**
 * Everything the measuring unit sends into the app, refreshed a few times per second:
 * all eight distances with their validity, the minima, mode, protocol, timing, slave state
 * and the counters, plus the hex of the last frame for protocol debugging.
 */
export const MerakLiveCard: React.FC<Props> = ({ title = 'Měřák – živá data' }) => {
  const { status, linkOk, profile, mode: wantedMode, measuring } = useBle();
  const { snap, now } = useMerakSnapshot(250);
  const { frame } = snap;
  const expected = profileInfo(profile);

  const frameProtocol = frame?.protocol ?? snap.lastUnsupported?.protocol ?? null;
  const protocolMismatch = frameProtocol !== null && frameProtocol !== expected.protocol;
  const modeMismatch = frame !== null && frame.mode !== wantedMode;
  const noDataWhileMeasuring = status === 'connected' && measuring && (!snap.frameAt || now - snap.frameAt > 1500);

  return (
    <Card style={styles.card} testID="merakLiveCard">
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.badge, status === 'connected' && linkOk ? styles.badgeOk : styles.badgeOff]}>
          {status === 'connected' ? (linkOk ? '● spojení OK' : '● bez signálu') : '○ nepřipojeno'}
        </Text>
      </View>

      {status !== 'connected' && (
        <Text style={styles.hint}>Měřák není připojený. Připojte ho na úvodní obrazovce.</Text>
      )}

      {status === 'connected' && !frame && !snap.lastUnsupported && (
        <Text style={styles.hint}>
          {measuring ? 'Čekám na první datový rámec…' : 'Měření neběží, datové rámce se neposílají (heartbeat ano).'}
        </Text>
      )}

      {noDataWhileMeasuring && (
        <View style={styles.warnBox} testID="merakNoData">
          <Text style={styles.warnBoxText}>Měření běží, ale rámce nechodí. Zkontrolujte měřák (příkaz Q, log níže).</Text>
        </View>
      )}

      {protocolMismatch && (
        <View style={styles.warnBox} testID="merakProtocolMismatch">
          <Text style={styles.warnBoxText}>
            Měřák posílá rámce protokolu {frameProtocol}, ale v aplikaci je zvoleno {expected.label} (protokol{' '}
            {expected.protocol}). Přepněte verzi firmware na úvodní obrazovce.
          </Text>
        </View>
      )}

      {modeMismatch && frame && (
        <View style={styles.warnBox}>
          <Text style={styles.warnBoxText}>
            Měřák posílá mód {frame.mode.toUpperCase()}, v aplikaci je zvolen {wantedMode.toUpperCase()}.
          </Text>
        </View>
      )}

      {snap.lastUnsupported && (
        <View style={styles.infoBox} testID="merakUnsupported">
          <Text style={styles.infoBoxText}>
            Rámec protokolu {snap.lastUnsupported.protocol} ({snap.lastUnsupported.length} B) zatím nemá v aplikaci
            parser, zobrazuje se jen hex. Přijato: {snap.unsupported}.
          </Text>
        </View>
      )}

      {frame && (frame.masterUnit.state === 'tooClose' || frame.slaveUnit.state === 'tooClose') && (
        <View style={styles.alarmBox} testID="merakTooClose">
          <Text style={styles.alarmText}>
            PŘÍLIŠ BLÍZKO:{' '}
            {[
              frame.masterUnit.state === 'tooClose' ? closeSensorText('master', 'J', frame.masterUnit) : null,
              frame.slaveUnit.state === 'tooClose' ? closeSensorText('slave', 'S', frame.slaveUnit) : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </View>
      )}

      {frame && (
        <>
          <View style={styles.units}>
            <UnitColumn
              testID="merakMaster"
              title="Master (levá)"
              prefix="J"
              values={frame.master}
              states={frame.masterStates}
              unit={frame.masterUnit}
              mode={frame.mode}
            />
            <UnitColumn
              testID="merakSlave"
              title="Slave (pravá)"
              prefix="S"
              values={frame.slave}
              states={frame.slaveStates}
              unit={frame.slaveUnit}
              mode={frame.mode}
            />
          </View>

          <View style={styles.infoGrid}>
            <Row label="Mód" value={`${frame.mode.toUpperCase()} (${frame.length} B)`} testID="merakFrameMode" />
            <Row label="Protokol" value={`v${frame.protocol}`} />
            <Row label="Měření běží" value={frame.measuringRunning ? 'ano' : 'ne'} />
            <Row label="Čas od startu (M)" value={formatMs(frame.timeMs)} testID="merakFrameTime" />
            <Row
              label="Slave"
              value={frame.slaveConnected ? 'připojen' : 'NEPŘIPOJEN'}
              warn={!frame.slaveConnected}
              testID="merakSlaveState"
            />
            <Row
              label="Stáří dat ze slave"
              value={frame.slaveAgeMs === null ? 'neznámé' : `${frame.slaveAgeMs} ms`}
              warn={frame.slaveAgeMs === null}
            />
          </View>
        </>
      )}

      <View style={styles.infoGrid}>
        <Row label="Rámců za sekundu" value={snap.fps.toFixed(1)} testID="merakFps" />
        <Row label="Rámců celkem" value={String(snap.frames)} testID="merakFrameCount" />
        <Row label="Poslední rámec" value={ago(now, snap.frameAt)} />
        <Row label="Heartbeat" value={`${ago(now, snap.heartbeatAt)} (celkem ${snap.heartbeats})`} warn={!linkOk && status === 'connected'} />
        <Row label="Odpovědi na příkazy" value={String(snap.replies)} />
        <Row label="Nerozpoznané rámce" value={String(snap.malformed + snap.unsupported)} warn={snap.malformed + snap.unsupported > 0} />
      </View>

      {snap.lastHex ? (
        <View style={styles.hexBox}>
          <Text style={styles.hexLabel}>Poslední rámec (hex)</Text>
          <Text style={styles.hex} selectable testID="merakHex">
            {snap.lastHex}
          </Text>
        </View>
      ) : null}
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
    marginBottom: UIConfig.spacing.md,
  },
  title: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
  },
  badge: {
    fontSize: UIConfig.fontSize.xs,
    fontWeight: '600',
  },
  badgeOk: {
    color: UIConfig.colors.success,
  },
  badgeOff: {
    color: UIConfig.colors.mutedForeground,
  },
  hint: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.sm,
  },
  warnBox: {
    backgroundColor: UIConfig.colors.warningLight,
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.md,
    marginBottom: UIConfig.spacing.sm,
  },
  warnBoxText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.warningForeground,
  },
  infoBox: {
    backgroundColor: UIConfig.colors.infoLight,
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.md,
    marginBottom: UIConfig.spacing.sm,
  },
  infoBoxText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.info,
  },
  units: {
    flexDirection: 'row',
    gap: UIConfig.spacing.md,
    marginBottom: UIConfig.spacing.md,
  },
  unit: {
    flex: 1,
  },
  unitTitle: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.sm,
  },
  sensorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: UIConfig.spacing.sm,
    borderRadius: UIConfig.borderRadius.sm,
    backgroundColor: UIConfig.colors.muted,
    marginBottom: 4,
  },
  sensorRowMin: {
    backgroundColor: UIConfig.colors.successLight,
    borderWidth: 1,
    borderColor: UIConfig.colors.success,
  },
  sensorName: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
  },
  sensorValue: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
    ...mono,
  },
  sensorRowClose: {
    backgroundColor: UIConfig.colors.destructiveLight,
    borderWidth: 1,
    borderColor: UIConfig.colors.destructive,
  },
  sensorState: {
    fontSize: UIConfig.fontSize.xs,
    fontWeight: '700',
  },
  stateClose: {
    color: UIConfig.colors.destructive,
  },
  stateFault: {
    color: UIConfig.colors.warningForeground,
  },
  stateNoTarget: {
    color: UIConfig.colors.mutedForeground,
  },
  alarmBox: {
    backgroundColor: UIConfig.colors.destructive,
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.md,
    marginBottom: UIConfig.spacing.sm,
  },
  alarmText: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '700',
    color: '#ffffff',
  },
  unitMin: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginTop: 2,
  },
  infoGrid: {
    borderTopWidth: 1,
    borderTopColor: UIConfig.colors.border,
    paddingTop: UIConfig.spacing.sm,
    marginTop: UIConfig.spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  infoLabel: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
  },
  infoValue: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '600',
    color: UIConfig.colors.foreground,
    ...mono,
  },
  warnText: {
    color: UIConfig.colors.destructive,
  },
  hexBox: {
    marginTop: UIConfig.spacing.md,
    padding: UIConfig.spacing.sm,
    borderRadius: UIConfig.borderRadius.sm,
    backgroundColor: UIConfig.colors.muted,
  },
  hexLabel: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginBottom: 2,
  },
  hex: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.foreground,
    ...mono,
  },
});
