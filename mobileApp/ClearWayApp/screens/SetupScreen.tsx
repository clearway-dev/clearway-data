import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform, useColorScheme } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CustomHeader } from '../components/ui/CustomHeader';
import { Segmented } from '../components/ui/Segmented';
import { ApiService } from '../services/api.service';
import { SessionStorageService } from '../services/session-storage.service';
import {
  MeasurementSource,
  MissingSensorError,
  TEST_SENSOR_DESCRIPTION,
  ensureSensor,
  findMerakSensor,
  findTestSensor,
  merakSensorDescription,
} from '../services/merak/sensor-records';
import { useAuth } from '../contexts/AuthContext';
import { useBle } from '../contexts/BleContext';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Vehicle, Sensor } from '../types/navigation';
import { UIConfig } from '../config/ui.config';

type SetupScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Setup'>;

interface Props {
  navigation: SetupScreenNavigationProp;
}

/** Marker stored as the "sensor" of the last selection, so the chosen source survives a restart. */
const LAST_SOURCE_MARKER: Record<MeasurementSource, string> = { merak: 'source:merak', simulation: 'source:simulation' };

export const SetupScreen: React.FC<Props> = ({ navigation }) => {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { status: merakStatus, deviceName, deviceInfo } = useBle();
  const merakConnected = merakStatus === 'connected';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [source, setSource] = useState<MeasurementSource>(merakConnected ? 'merak' : 'simulation');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Track the configuration for which session was created
  const [sessionVehicleId, setSessionVehicleId] = useState<string | null>(null);
  const [sessionSensorId, setSessionSensorId] = useState<string | null>(null);

  const serial = deviceInfo?.serial ?? null;
  const testSensor = findTestSensor(sensors);

  /** Backend sensor record of a source, undefined when it does not exist yet. */
  const recordFor = (src: MeasurementSource): Sensor | undefined => {
    if (src === 'simulation') return testSensor;
    if (merakConnected) return findMerakSensor(sensors, deviceName, serial);
    // Not connected: keep the unit the session was created with, so a restored session stays valid.
    return sensors.find((s) => s.id === sessionSensorId && s.id !== testSensor?.id);
  };
  const selectedSensorId = recordFor(source)?.id ?? null;

  const configurationChanged = sessionId && (
    selectedVehicleId !== sessionVehicleId ||
    selectedSensorId !== sessionSensorId
  );

  const isOriginalConfiguration = sessionId &&
    selectedVehicleId === sessionVehicleId &&
    selectedSensorId === sessionSensorId;

  useEffect(() => {
    const initialize = async () => {
      try {
        // Load vehicles, sensors, last session and last selection in parallel
        const [vehiclesData, sensorsData, savedSession, lastSelection] = await Promise.all([
          ApiService.getVehicles(),
          ApiService.getSensors(),
          SessionStorageService.loadSession(),
          SessionStorageService.loadLastSelection(),
        ]);

        setVehicles(vehiclesData);
        setSensors(sensorsData);

        const validVehicleIds = new Set(vehiclesData.map(v => v.id));
        const testId = findTestSensor(sensorsData)?.id;

        if (savedSession) {
          setSessionId(savedSession.sessionId);
          setSessionVehicleId(savedSession.vehicleId);
          setSessionSensorId(savedSession.sensorId);
          setSelectedVehicleId(savedSession.vehicleId);
          setSource(savedSession.sensorId === testId ? 'simulation' : 'merak');
          console.log('✓ Restored session from storage:', savedSession.sessionId);
        } else if (lastSelection && validVehicleIds.has(lastSelection.vehicleId)) {
          setSelectedVehicleId(lastSelection.vehicleId);
          if (lastSelection.sensorId === LAST_SOURCE_MARKER.simulation) setSource('simulation');
          if (lastSelection.sensorId === LAST_SOURCE_MARKER.merak) setSource('merak');
          console.log('✓ Restored last selection from storage');
        } else if (vehiclesData.length > 0) {
          setSelectedVehicleId(vehiclesData[0].id);
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization failed:', error);
        setIsInitialized(true); // Show UI even on error
        Alert.alert('Chyba', 'Nepodařilo se inicializovat aplikaci. Zkontrolujte internetové připojení.');
      }
    };

    initialize();
  }, []);

  const chooseSource = (next: MeasurementSource) => {
    setSource(next);
    SessionStorageService.saveLastSelection(selectedVehicleId ?? '', LAST_SOURCE_MARKER[next]);
  };

  const askToConnect = () => {
    Alert.alert('Měřák není připojený', 'Připojte měřák v Nastavit měření, nebo zvolte Testovací měřák.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Připojit měřák', onPress: () => navigation.navigate('MerakSetup') },
    ]);
  };

  const handleCreateSession = async () => {
    if (!selectedVehicleId) {
      Alert.alert('Chyba', 'Vyberte vozidlo a měřák');
      return;
    }
    if (source === 'merak' && !merakConnected) {
      askToConnect();
      return;
    }

    if (isOriginalConfiguration) {
      Alert.alert(
        'Session již existuje',
        'Pro tuto kombinaci vozidla a měřáku již existuje Session ID. Chcete použít existující, nebo vytvořit novou?',
        [
          { text: 'Zrušit', style: 'cancel' },
          {
            text: 'Použít existující',
            onPress: () => {
              console.log('✓ Using existing session:', sessionId);
            },
          },
          {
            text: 'Vytvořit novou',
            style: 'default',
            onPress: async () => {
              await createNewSession();
            },
          },
        ]
      );
      return;
    }

    await createNewSession();
  };

  const createNewSession = async () => {
    if (!selectedVehicleId) return;

    setIsLoading(true);
    try {
      // Each source has its own sensor record, so test data never mixes with real data.
      let sensor = recordFor(source);
      if (!sensor) {
        const description = source === 'simulation' ? TEST_SENSOR_DESCRIPTION : merakSensorDescription(deviceName, serial);
        sensor = await ensureSensor(sensors, description, isAdmin);
        const created = sensor;
        setSensors((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
      }

      const session = await ApiService.createSession(selectedVehicleId, sensor.id);
      setSessionId(session.id);
      setSessionVehicleId(selectedVehicleId);
      setSessionSensorId(sensor.id);

      await SessionStorageService.saveSession(session.id, selectedVehicleId, sensor.id);

      console.log('✓ New session created and saved:', session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
      setSessionId(null);
      if (error instanceof MissingSensorError) {
        Alert.alert(
          'Chybí senzor na serveru',
          `${error.message} Stačí, aby administrátor jednou vytvořil jízdu s tímto měřákem.`
        );
      } else {
        Alert.alert('Chyba', 'Nepodařilo se vytvořit novou jízdu. Zkontrolujte připojení k serveru.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartMeasurement = async () => {
    if (!sessionId || !selectedVehicleId || !sessionSensorId) {
      Alert.alert('Chyba', 'Nejprve vyberte vozidlo a měřák');
      return;
    }
    if (source === 'merak' && !merakConnected) {
      askToConnect();
      return;
    }

    // Double check it's saved (should be already, but for safety)
    await SessionStorageService.saveSession(sessionId, selectedVehicleId, sessionSensorId);

    navigation.navigate('Measurement', {
      sessionId,
      vehicleId: selectedVehicleId,
      sensorId: sessionSensorId,
      dataSource: source,
    });
  };

  const handleClose = () => {
    navigation.navigate('Home');
  };

  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#18181b" />
        <Text style={styles.loadingText}>Inicializace...</Text>
      </View>
    );
  }

  // Can start only if session exists and configuration hasn't changed
  const canStartMeasurement = !isLoading && sessionId && !configurationChanged;

  return (
    <View style={styles.container}>
      <CustomHeader variant="close" onClose={handleClose} title="Nastavení měření" />

      <ScrollView contentContainerStyle={styles.content}>
      {/* Vehicle Selection */}
      <Card style={styles.card}>
        <Text style={styles.label}>Vozidlo:</Text>
        {vehicles.length > 0 ? (
          <Picker
            selectedValue={selectedVehicleId}
            onValueChange={(value) => {
              const nextVehicleId = value ?? '';
              setSelectedVehicleId(nextVehicleId);
              SessionStorageService.saveLastSelection(nextVehicleId, LAST_SOURCE_MARKER[source]);
            }}
            enabled={true}
            style={{
              color: isDarkMode ? '#ffffff' : '#000000',
              backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
            }}
            dropdownIconColor={isDarkMode ? '#ffffff' : '#000000'}
          >
            {vehicles.map(v => (
              <Picker.Item
                key={v.id}
                label={`${v.vehicle_name} (${v.width}cm)`}
                value={v.id}
                enabled={true}
                color={Platform.OS === 'android' ? (isDarkMode ? '#ffffff' : '#000000') : undefined}
              />
            ))}
          </Picker>
        ) : (
          <Text style={styles.errorText}>Žádná vozidla k dispozici</Text>
        )}
      </Card>

      {/* Measuring unit: the connected one, or the test generator */}
      <Card style={styles.card} testID="sourceCard">
        <Text style={styles.label}>Měřák:</Text>
        <Segmented<MeasurementSource>
          testIDPrefix="source"
          value={source}
          onChange={chooseSource}
          options={[
            { value: 'merak', label: 'Připojený měřák', hint: merakConnected ? deviceName ?? 'měřák' : 'nepřipojen' },
            { value: 'simulation', label: 'Testovací', hint: 'náhodná data' },
          ]}
        />
        {source === 'merak' ? (
          merakConnected ? (
            <Text style={styles.sourceOk} testID="sourceInfo">
              ● {deviceName}
              {deviceInfo ? ` · FW ${deviceInfo.firmware}` : ''}
              {serial ? ` · SN ${serial}` : ''}
            </Text>
          ) : (
            <>
              <Text style={styles.warningText} testID="sourceInfo">
                Měřák není připojený. Připojte ho, nebo zvolte Testovací.
              </Text>
              <Button
                testID="connectMerakFromSetup"
                title="Připojit měřák"
                onPress={() => navigation.navigate('MerakSetup')}
                variant="secondary"
                style={styles.connectButton}
              />
            </>
          )
        ) : (
          <Text style={styles.sourceHint} testID="sourceInfo">
            Aplikace generuje náhodná data jako bez měřáku. Ukládají se pod senzor „Testovací měřák“, odděleně
            od skutečných měření.
          </Text>
        )}
      </Card>

      {/* Create Session Button */}
      <Button
        testID="createSessionButton"
        title={isLoading ? "Vytváření jízdy..." : "Vytvořit jízdu"}
        onPress={handleCreateSession}
        disabled={isLoading || !selectedVehicleId}
        variant="secondary"
        style={styles.createSessionButton}
      />

      {/* Session Info */}
      {sessionId && !isLoading && (
        <Card style={[styles.card, configurationChanged ? styles.warningCard : styles.successCard]}>
          <Text style={styles.label}>Session ID:</Text>
          <Text style={styles.sessionId}>{sessionId}</Text>

          {configurationChanged ? (
            <Text style={styles.warningText}>⚠ Konfigurace se změnila - vygenerujte novou jízdu</Text>
          ) : (
            <Text style={styles.successText}>✓ Jízda připravena</Text>
          )}
        </Card>
      )}

      {/* Start Button */}
      <Button
        testID="startMeasurementButton"
        title="Start měření"
        onPress={handleStartMeasurement}
        disabled={!canStartMeasurement}
        style={styles.startButton}
      />

      {!sessionId && !isLoading && (
        <Text style={styles.hintText}>
          Vygenerujte jízdu tlačítkem "Vytvořit jízdu"
        </Text>
      )}

      {configurationChanged && (
        <Text style={styles.hintText}>
          Konfigurace se změnila. Vygenerujte novou jízdu pro pokračování.
        </Text>
      )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UIConfig.colors.background,
  },
  content: {
    padding: UIConfig.spacing.xl,
  },
  card: {
    marginBottom: UIConfig.spacing.lg,
  },
  successCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  warningCard: {
    backgroundColor: '#fffbeb',
    borderColor: '#fbbf24',
  },
  label: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '500',
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.sm,
  },
  sessionId: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
    fontFamily: 'monospace',
    marginBottom: UIConfig.spacing.sm,
  },
  successText: {
    fontSize: UIConfig.fontSize.sm,
    color: '#16a34a',
    fontWeight: '500',
  },
  warningText: {
    fontSize: UIConfig.fontSize.sm,
    color: '#d97706',
    fontWeight: '500',
    marginTop: UIConfig.spacing.sm,
  },
  errorText: {
    color: UIConfig.colors.destructive,
    fontSize: UIConfig.fontSize.sm,
  },
  sourceOk: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.success,
    fontWeight: '600',
    marginTop: UIConfig.spacing.sm,
  },
  sourceHint: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginTop: UIConfig.spacing.sm,
  },
  connectButton: {
    marginTop: UIConfig.spacing.sm,
  },
  createSessionButton: {
    marginTop: UIConfig.spacing.sm,
    marginBottom: UIConfig.spacing.lg,
    paddingVertical: UIConfig.spacing.md,
  },
  startButton: {
    marginTop: UIConfig.spacing.xl,
    paddingVertical: UIConfig.spacing.lg,
  },
  hintText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
    textAlign: 'center',
    marginTop: UIConfig.spacing.md,
  },
  loadingText: {
    marginTop: UIConfig.spacing.md,
    color: UIConfig.colors.mutedForeground,
  },
});
