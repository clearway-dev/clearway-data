import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Segmented } from '../ui/Segmented';
import { UIConfig } from '../../config/ui.config';
import { useBle } from '../../contexts/BleContext';
import { FW_PROFILES, FwProfile, profileInfo } from '../../services/merak/commands';
import type { MerakMode } from '../../services/merak/protocol';

interface Props {
  onOpenService: () => void;
}

/**
 * Connection of the measuring unit over Bluetooth, the data mode (what the unit sends and what
 * the app stores) and the firmware generation the app talks to.
 */
export const MerakConnectCard: React.FC<Props> = ({ onOpenService }) => {
  const {
    supported,
    status,
    deviceName,
    error,
    linkOk,
    mode,
    swapSides,
    profile,
    deviceInfo,
    connect,
    disconnect,
    setMode,
    setSwapSides,
    setProfile,
  } = useBle();

  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const expected = profileInfo(profile);
  const minBytes = expected.protocol >= 2 ? 14 : 13;
  const rawBytes = expected.protocol >= 2 ? 27 : 25;
  const firmwareMismatch = deviceInfo !== null && deviceInfo.protocol !== expected.protocol;

  const statusText = connecting
    ? 'Připojuji…'
    : connected
      ? `${linkOk ? '●' : '○'} ${deviceName ?? 'měřák'}${deviceInfo ? ` · FW ${deviceInfo.firmware}` : ''}`
      : supported
        ? '○ Nepřipojeno'
        : '○ Bluetooth tu není dostupný';

  return (
    <Card style={styles.card} testID="merakConnectCard">
      <Text style={styles.title}>Měřák (Bluetooth)</Text>
      <Text style={[styles.status, connected && linkOk && styles.statusOk]} testID="merakStatusText">
        {statusText}
      </Text>

      {error ? (
        <Text style={styles.error} testID="merakError">
          {error}
        </Text>
      ) : null}

      <Button
        testID="connectMerakButton"
        title={connected ? 'Odpojit měřák' : 'Připojit měřák'}
        onPress={() => {
          void (connected ? disconnect() : connect());
        }}
        loading={connecting}
        disabled={!supported && !connected}
        variant={connected ? 'secondary' : 'primary'}
        style={styles.button}
      />

      <Text style={styles.label}>Co měřák posílá</Text>
      <Segmented<MerakMode>
        testIDPrefix="merakMode"
        value={mode}
        onChange={(m) => {
          void setMode(m);
        }}
        options={[
          { value: 'min', label: 'MIN', hint: 'minimum levá + pravá (výchozí)' },
          { value: 'raw', label: 'RAW', hint: 'všech 8 senzorů' },
        ]}
      />
      <Text style={styles.note}>
        {mode === 'min'
          ? `Měřák pošle nejkratší vzdálenost za levý a za pravý měřák (${minBytes} B).`
          : `Měřák pošle všech 8 senzorů (${rawBytes} B), aplikace uloží minimum za každou stranu.`}
      </Text>

      <Text style={styles.label}>Verze firmware měřáku</Text>
      <Segmented<FwProfile>
        testIDPrefix="merakProfile"
        value={profile}
        onChange={setProfile}
        options={FW_PROFILES.map((p) => ({ value: p.id, label: p.label, hint: `protokol ${p.protocol}` }))}
      />
      <Text style={styles.note} testID="merakProfileNote">
        {expected.note}
      </Text>
      {firmwareMismatch && deviceInfo && (
        <Text style={styles.warn} testID="merakFirmwareMismatch">
          Připojený měřák hlásí FW {deviceInfo.firmware} (protokol {deviceInfo.protocol}), ale zvoleno je{' '}
          {expected.label}. Přepněte verzi.
        </Text>
      )}

      <View style={styles.swapRow}>
        <Text style={styles.swapText}>
          Strany: master = {swapSides ? 'pravá' : 'levá'}, slave = {swapSides ? 'levá' : 'pravá'}
        </Text>
        <Button
          testID="merakSwapSides"
          title="Prohodit"
          variant="secondary"
          onPress={() => setSwapSides(!swapSides)}
          style={styles.swapButton}
        />
      </View>

      <Button
        testID="openMerakService"
        title="Servis měřáku"
        variant="secondary"
        onPress={onOpenService}
        style={styles.button}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 520,
    marginBottom: UIConfig.spacing.xl,
  },
  title: {
    fontSize: UIConfig.fontSize.lg,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  status: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.md,
  },
  statusOk: {
    color: UIConfig.colors.success,
    fontWeight: '600',
  },
  error: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.destructive,
    marginBottom: UIConfig.spacing.md,
  },
  warn: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.warningForeground,
    backgroundColor: UIConfig.colors.warningLight,
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.md,
    marginTop: UIConfig.spacing.sm,
  },
  button: {
    marginVertical: UIConfig.spacing.md,
  },
  label: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '600',
    color: UIConfig.colors.mutedForeground,
    marginTop: UIConfig.spacing.sm,
    marginBottom: UIConfig.spacing.sm,
  },
  note: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginTop: UIConfig.spacing.xs,
  },
  swapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: UIConfig.spacing.lg,
  },
  swapText: {
    flex: 1,
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
  },
  swapButton: {
    paddingVertical: 8,
    minHeight: 40,
  },
});
