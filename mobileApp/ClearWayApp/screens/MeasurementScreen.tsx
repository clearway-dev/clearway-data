import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ApiService } from '../services/api.service';
import { DatabaseService } from '../services/database.service';
import { useMeasurement } from '../hooks/useMeasurement';
import { useSync } from '../hooks/useSync';
import { Vehicle, Sensor } from '../types';

export const MeasurementScreen: React.FC = () => {
  // State
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Hooks
  const { isRecording, measurementCount, currentLocation, locationError, permissionGranted, startRecording, stopRecording } = useMeasurement(sessionId);
  const { stats, forceSync } = useSync(isRecording);

  // Initialize database and load data
  useEffect(() => {
    const initialize = async () => {
      try {
        // Initialize SQLite
        await DatabaseService.initialize();
        
        // Load vehicles and sensors
        const [vehiclesData, sensorsData] = await Promise.all([
          ApiService.getVehicles(),
          ApiService.getSensors(),
        ]);
        
        setVehicles(vehiclesData);
        setSensors(sensorsData);
        
        // Auto-select first vehicle and sensor
        if (vehiclesData.length > 0) {
          setSelectedVehicleId(vehiclesData[0].id);
        }
        if (sensorsData.length > 0) {
          setSelectedSensorId(sensorsData[0].id);
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

  // Create session
  const handleCreateSession = async () => {
    if (!selectedVehicleId || !selectedSensorId) {
      Alert.alert('Chyba', 'Vyberte vozidlo a senzor');
      return;
    }

    setIsLoading(true);
    try {
      const session = await ApiService.createSession(selectedVehicleId, selectedSensorId);
      setSessionId(session.id);
      Alert.alert('Úspěch', 'Nová jízda byla vytvořena');
    } catch (error) {
      Alert.alert('Chyba', 'Nepodařilo se vytvořit jízdu');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Start/stop recording
  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      if (!sessionId) {
        Alert.alert('Chyba', 'Nejprve vytvořte novou jízdu');
        return;
      }
      if (!permissionGranted) {
        Alert.alert('Chyba', 'Aplikace nemá oprávnění k poloze');
        return;
      }
      startRecording();
    }
  };

  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text>Inicializace...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>ClearWay Měření</Text>

      {/* Vehicle Selection */}
      <Card style={styles.card}>
        <Text style={styles.label}>Vozidlo:</Text>
        <Picker
          selectedValue={selectedVehicleId}
          onValueChange={(value) => setSelectedVehicleId(value)}
          enabled={!isRecording}
        >
          {vehicles.map(v => (
            <Picker.Item key={v.id} label={`${v.vehicle_name} (${v.width}cm)`} value={v.id} />
          ))}
        </Picker>
      </Card>

      {/* Sensor Selection */}
      <Card style={styles.card}>
        <Text style={styles.label}>Senzor:</Text>
        <Picker
          selectedValue={selectedSensorId}
          onValueChange={(value) => setSelectedSensorId(value)}
          enabled={!isRecording}
        >
          {sensors.map(s => (
            <Picker.Item key={s.id} label={s.description || `Senzor ${s.id}`} value={s.id} />
          ))}
        </Picker>
      </Card>

      {/* Session Control */}
      {!sessionId && (
        <Button
          title="Vytvořit novou jízdu"
          onPress={handleCreateSession}
          loading={isLoading}
          disabled={isLoading || !selectedVehicleId || !selectedSensorId}
        />
      )}

      {sessionId && (
        <>
          <Card style={styles.card}>
            <Text style={styles.label}>Session ID:</Text>
            <Text style={styles.value}>{sessionId}</Text>
          </Card>

          {/* Recording Control */}
          <Button
            title={isRecording ? 'STOP' : 'START'}
            onPress={handleToggleRecording}
            variant={isRecording ? 'secondary' : 'primary'}
            disabled={!permissionGranted}
          />

          {/* Location Error */}
          {locationError && (
            <Card style={[styles.card, styles.errorCard]}>
              <Text style={styles.errorText}>{locationError}</Text>
            </Card>
          )}

          {/* Current Status */}
          {isRecording && (
            <Card style={styles.card}>
              <Text style={styles.label}>Status: Nahrávání...</Text>
              <Text style={styles.value}>Měření: {measurementCount}</Text>
              {currentLocation && (
                <>
                  <Text style={styles.value}>Lat: {currentLocation.latitude.toFixed(6)}°</Text>
                  <Text style={styles.value}>Lon: {currentLocation.longitude.toFixed(6)}°</Text>
                  {currentLocation.accuracy && (
                    <Text style={styles.value}>Přesnost: {currentLocation.accuracy.toFixed(1)}m</Text>
                  )}
                </>
              )}
            </Card>
          )}

          {/* Database Stats */}
          <Card style={styles.card}>
            <Text style={styles.label}>Lokální databáze:</Text>
            <Text style={styles.value}>Celkem: {stats.total} měření</Text>
            <Text style={styles.value}>Neodesláno: {stats.unsynced} měření</Text>
            <Button
              title="Odeslat nyní"
              onPress={forceSync}
              variant="secondary"
              style={styles.syncButton}
            />
          </Card>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  card: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#71717a',
    marginBottom: 8,
  },
  value: {
    fontSize: 16,
    color: '#18181b',
    marginBottom: 4,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  errorText: {
    color: '#dc2626',
  },
  syncButton: {
    marginTop: 12,
  },
});
