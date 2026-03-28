import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ApiService } from '../services/api.service';
import { DatabaseService } from '../services/database.service';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, Vehicle, Sensor } from '../types/navigation';

type SetupScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Setup'>;

interface Props {
  navigation: SetupScreenNavigationProp;
}

export const SetupScreen: React.FC<Props> = ({ navigation }) => {
  // State
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

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
        
        // Auto-select first vehicle and sensor if available
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

  // Generate new session_id whenever vehicle or sensor changes
  useEffect(() => {
    const createSession = async () => {
      if (!selectedVehicleId || !selectedSensorId) {
        setSessionId(null);
        return;
      }

      setIsLoading(true);
      try {
        const session = await ApiService.createSession(selectedVehicleId, selectedSensorId);
        setSessionId(session.id);
        console.log('✓ New session created:', session.id);
      } catch (error) {
        console.error('Failed to create session:', error);
        setSessionId(null);
        Alert.alert('Chyba', 'Nepodařilo se vytvořit novou jízdu. Zkontrolujte připojení k serveru.');
      } finally {
        setIsLoading(false);
      }
    };

    createSession();
  }, [selectedVehicleId, selectedSensorId]);

  const handleStartMeasurement = () => {
    if (!sessionId || !selectedVehicleId || !selectedSensorId) {
      Alert.alert('Chyba', 'Nejprve vyberte vozidlo a senzor');
      return;
    }

    navigation.navigate('Measurement', {
      sessionId,
      vehicleId: selectedVehicleId,
      sensorId: selectedSensorId,
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

  const canStartMeasurement = !isLoading && sessionId && selectedVehicleId && selectedSensorId;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Close Button */}
      <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
        <Text style={styles.closeButtonText}>✕</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Nastavení měření</Text>

      {/* Vehicle Selection */}
      <Card style={styles.card}>
        <Text style={styles.label}>Vozidlo:</Text>
        {vehicles.length > 0 ? (
          <Picker
            selectedValue={selectedVehicleId}
            onValueChange={(value) => setSelectedVehicleId(value)}
            enabled={true}
          >
            {vehicles.map(v => (
              <Picker.Item key={v.id} label={`${v.vehicle_name} (${v.width}cm)`} value={v.id} enabled={true} />
            ))}
          </Picker>
        ) : (
          <Text style={styles.errorText}>Žádná vozidla k dispozici</Text>
        )}
      </Card>

      {/* Sensor Selection */}
      <Card style={styles.card}>
        <Text style={styles.label}>Senzor:</Text>
        {sensors.length > 0 ? (
          <Picker
            selectedValue={selectedSensorId}
            onValueChange={(value) => setSelectedSensorId(value)}
            enabled={true}
          >
            {sensors.map(s => (
              <Picker.Item key={s.id} label={s.description || `Senzor ${s.id}`} value={s.id} enabled={true} />
            ))}
          </Picker>
        ) : (
          <Text style={styles.errorText}>Žádné senzory k dispozici</Text>
        )}
      </Card>

      {/* Session Info */}
      {isLoading && (
        <Card style={styles.card}>
          <ActivityIndicator size="small" color="#18181b" />
          <Text style={styles.infoText}>Vytváření nové jízdy...</Text>
        </Card>
      )}

      {sessionId && !isLoading && (
        <Card style={[styles.card, styles.successCard]}>
          <Text style={styles.label}>Session ID:</Text>
          <Text style={styles.sessionId}>{sessionId}</Text>
          <Text style={styles.successText}>✓ Nová jízda připravena</Text>
        </Card>
      )}

      {/* Start Button */}
      <Button
        title="Start měření"
        onPress={handleStartMeasurement}
        disabled={!canStartMeasurement}
        style={styles.startButton}
      />

      {!canStartMeasurement && !isLoading && (
        <Text style={styles.hintText}>
          Vyberte vozidlo a senzor pro vytvoření nové jízdy
        </Text>
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
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e4e4e7',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#18181b',
    fontWeight: '300',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#18181b',
  },
  card: {
    marginBottom: 16,
  },
  successCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#71717a',
    marginBottom: 8,
  },
  sessionId: {
    fontSize: 14,
    color: '#18181b',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  successText: {
    fontSize: 14,
    color: '#16a34a',
    fontWeight: '500',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
  },
  infoText: {
    fontSize: 14,
    color: '#71717a',
    marginTop: 8,
    textAlign: 'center',
  },
  startButton: {
    marginTop: 24,
    paddingVertical: 16,
  },
  hintText: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
    marginTop: 12,
  },
  loadingText: {
    marginTop: 12,
    color: '#71717a',
  },
});
