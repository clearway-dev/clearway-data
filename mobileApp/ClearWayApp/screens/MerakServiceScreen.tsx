import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CustomHeader } from '../components/ui/CustomHeader';
import { confirmAsync } from '../components/ui/confirm';
import { MerakLiveCard } from '../components/merak/MerakLiveCard';
import { MerakLogCard } from '../components/merak/MerakLogCard';
import { UIConfig } from '../config/ui.config';
import { CommandResult, useBle } from '../contexts/BleContext';
import {
  COMMANDS,
  CommandDef,
  CommandGroup,
  GROUP_TITLE,
  ResultRow,
  buildCommand,
  describeReplyValue,
  parseServiceText,
  profileInfo,
} from '../services/merak/commands';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'MerakService'>;

interface Props {
  navigation: Navigation;
}

interface Outcome {
  result?: CommandResult;
  error?: string;
}

const GROUP_ORDER: CommandGroup[] = ['settings', 'info', 'service', 'system'];

const ResultView: React.FC<{ def: CommandDef; outcome: Outcome }> = ({ def, outcome }) => {
  if (outcome.error) {
    return (
      <View style={[styles.result, styles.resultBad]} testID={`result-${def.id}`}>
        <Text style={styles.resultBadText}>{outcome.error}</Text>
      </View>
    );
  }
  const r = outcome.result;
  if (!r) return null;
  const meaning = describeReplyValue(r.command, r.value);
  const rows: ResultRow[] = parseServiceText(def.id, r.message);
  return (
    <View style={[styles.result, r.ok ? styles.resultOk : styles.resultBad]} testID={`result-${def.id}`}>
      <Text style={[styles.resultHead, r.ok ? styles.resultOkText : styles.resultBadText]}>
        {r.ok ? 'OK' : `Chyba: ${r.statusLabel}`} · {(r.durationMs / 1000).toFixed(1)} s · odesláno „{r.sent}“
      </Text>
      {r.ok && meaning ? <Text style={styles.resultLine}>{meaning}</Text> : null}
      {r.ok && !meaning ? <Text style={styles.resultLine}>hodnota {r.value}</Text> : null}
      {rows.map((row, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={styles.tableLabel}>{row.label}</Text>
          <Text style={[styles.tableValue, row.ok === false && styles.resultBadText, row.ok === true && styles.resultOkText]}>
            {row.value}
          </Text>
        </View>
      ))}
      {r.message ? (
        <Text style={styles.raw} selectable>
          {r.message}
        </Text>
      ) : null}
    </View>
  );
};

export const MerakServiceScreen: React.FC<Props> = ({ navigation }) => {
  const {
    supported,
    status,
    deviceName,
    mtu,
    error,
    linkOk,
    profile,
    deviceInfo,
    measuring,
    connect,
    disconnect,
    runCommand,
    startMeasurement,
    stopMeasurement,
  } = useBle();

  const [args, setArgs] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [measureError, setMeasureError] = useState<string | null>(null);

  const connected = status === 'connected';
  const expected = profileInfo(profile);
  const mismatch = deviceInfo !== null && deviceInfo.protocol !== expected.protocol;

  const setOutcome = (id: string, outcome: Outcome) => setOutcomes((prev) => ({ ...prev, [id]: outcome }));

  const run = async (def: CommandDef) => {
    let arg: number | undefined;
    if (def.arg) {
      arg = Number(args[def.id] ?? def.arg.defaultValue);
    }
    try {
      buildCommand(def, arg);
    } catch (e) {
      setOutcome(def.id, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (def.confirm && !(await confirmAsync(def.title, def.confirm, 'Odeslat', true))) return;

    setBusyId(def.id);
    setOutcome(def.id, {});
    try {
      const result = await runCommand(def, arg);
      setOutcome(def.id, { result });
    } catch (e) {
      setOutcome(def.id, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  };

  const toggleMeasurement = async () => {
    setMeasureError(null);
    setBusyId('measure');
    try {
      const ok = measuring ? await stopMeasurement() : await startMeasurement();
      if (!ok) setMeasureError('Měřák nepotvrdil požadovaný stav měření.');
    } catch (e) {
      setMeasureError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.container}>
      <CustomHeader title="Servis měřáku" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Card style={styles.card} testID="merakServiceStatus">
          <Text style={styles.cardTitle}>Připojení</Text>
          <Text style={[styles.line, connected && linkOk && styles.okText]}>
            {connected
              ? `${linkOk ? '●' : '○'} ${deviceName ?? 'měřák'}${mtu ? ` · MTU ${mtu}` : ''}`
              : status === 'connecting'
                ? 'Připojuji…'
                : supported
                  ? '○ Nepřipojeno'
                  : '○ Bluetooth tu není dostupný'}
          </Text>
          {deviceInfo && (
            <>
              <Text style={styles.line}>
                Firmware {deviceInfo.firmware} · {deviceInfo.role} · protokol {deviceInfo.protocol}
              </Text>
              <Text style={styles.line}>Sériové číslo {deviceInfo.serial}</Text>
              <Text style={deviceInfo.devBuild ? styles.line : styles.warnText}>
                {deviceInfo.devBuild
                  ? 'Vývojový build bez šifrování: !tx a !rate jsou přes BLE povolené.'
                  : 'Produkční build: !tx a !rate přes BLE měřák odmítne (stav 3), jdou jen po sériové lince.'}
              </Text>
            </>
          )}
          <Text style={styles.line}>
            Aplikace mluví s: {expected.label} (protokol {expected.protocol})
          </Text>
          {mismatch && deviceInfo && (
            <Text style={styles.warnBox}>
              Měřák hlásí protokol {deviceInfo.protocol}, v aplikaci je {expected.label}. Přepněte verzi na úvodní obrazovce.
            </Text>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Button
            testID="serviceConnectButton"
            title={connected ? 'Odpojit' : 'Připojit měřák'}
            variant={connected ? 'secondary' : 'primary'}
            loading={status === 'connecting'}
            disabled={!supported && !connected}
            onPress={() => {
              void (connected ? disconnect() : connect());
            }}
            style={styles.button}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Měření (M)</Text>
          <Text style={styles.desc}>
            Spustí nebo zastaví měření v měřáku. Před startem aplikace znovu pošle mód a frekvenci, protože je měřák
            nedokáže vrátit zpět.
          </Text>
          <Text style={[styles.line, measuring && styles.okText]}>{measuring ? '● Měření běží' : '○ Měření neběží'}</Text>
          {measureError ? <Text style={styles.errorText}>{measureError}</Text> : null}
          <Button
            testID="toggleMeasureButton"
            title={measuring ? 'Zastavit měření' : 'Spustit měření'}
            variant={measuring ? 'secondary' : 'primary'}
            disabled={!connected || (busyId !== null && busyId !== 'measure')}
            loading={busyId === 'measure'}
            onPress={() => {
              void toggleMeasurement();
            }}
            style={styles.button}
          />
        </Card>

        <MerakLiveCard />

        {GROUP_ORDER.map((group) => (
          <View key={group}>
            <Text style={styles.groupTitle}>{GROUP_TITLE[group]}</Text>
            {COMMANDS.filter((c) => c.group === group).map((def) => {
              const busy = busyId === def.id;
              return (
                <Card key={def.id} style={styles.card} testID={`command-${def.id}`}>
                  <Text style={styles.cardTitle}>{def.title}</Text>
                  <Text style={styles.desc}>{def.description}</Text>
                  {def.devBuildOnly && <Text style={styles.tag}>jen vývojový build (BLE bez párování)</Text>}

                  {def.arg && (
                    <View style={styles.argRow}>
                      <Text style={styles.argLabel}>
                        {def.arg.label} ({def.arg.min}–{def.arg.max} {def.arg.unit})
                      </Text>
                      <TextInput
                        testID={`arg-${def.id}`}
                        style={styles.input}
                        keyboardType="number-pad"
                        value={args[def.id] ?? String(def.arg.defaultValue)}
                        onChangeText={(t) => setArgs((prev) => ({ ...prev, [def.id]: t.replace(/[^0-9]/g, '') }))}
                        editable={!busy}
                        maxLength={3}
                      />
                    </View>
                  )}

                  <Button
                    testID={`run-${def.id}`}
                    title={busy ? `Probíhá… (cca ${def.expectedSeconds ?? 1} s)` : 'Odeslat'}
                    variant="secondary"
                    disabled={!connected || (busyId !== null && !busy)}
                    onPress={() => {
                      void run(def);
                    }}
                    style={styles.button}
                  />
                  {busy && def.longRunning && <ActivityIndicator style={styles.spinner} />}

                  {outcomes[def.id] ? <ResultView def={def} outcome={outcomes[def.id]} /> : null}
                </Card>
              );
            })}
          </View>
        ))}

        <MerakLogCard />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UIConfig.colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: UIConfig.spacing.xl,
    paddingBottom: UIConfig.spacing.xxxl,
  },
  card: {
    marginBottom: UIConfig.spacing.lg,
  },
  cardTitle: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  groupTitle: {
    fontSize: UIConfig.fontSize.lg,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
    marginTop: UIConfig.spacing.md,
    marginBottom: UIConfig.spacing.md,
  },
  desc: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.sm,
  },
  line: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  okText: {
    color: UIConfig.colors.success,
    fontWeight: '600',
  },
  warnText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.warningForeground,
    marginBottom: UIConfig.spacing.xs,
  },
  warnBox: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.warningForeground,
    backgroundColor: UIConfig.colors.warningLight,
    borderRadius: UIConfig.borderRadius.md,
    padding: UIConfig.spacing.md,
    marginTop: UIConfig.spacing.sm,
  },
  errorText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.destructive,
    marginVertical: UIConfig.spacing.xs,
  },
  tag: {
    alignSelf: 'flex-start',
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.warningForeground,
    backgroundColor: UIConfig.colors.warningLight,
    borderRadius: UIConfig.borderRadius.sm,
    paddingHorizontal: UIConfig.spacing.sm,
    paddingVertical: 2,
    marginBottom: UIConfig.spacing.sm,
  },
  button: {
    marginTop: UIConfig.spacing.sm,
  },
  spinner: {
    marginTop: UIConfig.spacing.sm,
  },
  argRow: {
    marginVertical: UIConfig.spacing.sm,
  },
  argLabel: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: UIConfig.colors.input,
    borderRadius: UIConfig.borderRadius.md,
    paddingHorizontal: UIConfig.spacing.md,
    paddingVertical: UIConfig.spacing.sm,
    fontSize: UIConfig.fontSize.md,
    color: UIConfig.colors.foreground,
    backgroundColor: UIConfig.colors.background,
    minHeight: UIConfig.button.minHeight,
  },
  result: {
    marginTop: UIConfig.spacing.md,
    padding: UIConfig.spacing.md,
    borderRadius: UIConfig.borderRadius.md,
    borderWidth: 1,
  },
  resultOk: {
    backgroundColor: UIConfig.colors.successLight,
    borderColor: UIConfig.colors.success,
  },
  resultBad: {
    backgroundColor: UIConfig.colors.destructiveLight,
    borderColor: UIConfig.colors.destructiveBorder,
  },
  resultHead: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
    marginBottom: UIConfig.spacing.xs,
  },
  resultOkText: {
    color: UIConfig.colors.success,
  },
  resultBadText: {
    color: UIConfig.colors.destructive,
    fontSize: UIConfig.fontSize.sm,
  },
  resultLine: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  tableLabel: {
    flex: 1,
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
    fontWeight: '600',
  },
  tableValue: {
    flex: 2,
    textAlign: 'right',
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
  },
  raw: {
    marginTop: UIConfig.spacing.sm,
    fontSize: UIConfig.fontSize.xs,
    fontFamily: 'monospace',
    color: UIConfig.colors.mutedForeground,
  },
});
