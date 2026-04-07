import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CustomHeader } from '../components/ui/CustomHeader';
import { ApiService } from '../services/api.service';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Vehicle, Sensor } from '../types/navigation';
import { UIConfig } from '../config/ui.config';

type SetupScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Setup'>;

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
  
  // Track the configuration for which session was created
  const [sessionVehicleId, setSessionVehicleId] = useState<string | null>(null);
  const [sessionSensorId, setSessionSensorId] = useState<string | null>(null);
  
  // Check if current selection matches session configuration
  const configurationChanged = sessionId && (
    selectedVehicleId !== sessionVehicleId || 
    selectedSensorId !== sessionSensorId
  );
  
  // Check if we're back to original configuration
  const isOriginalConfiguration = sessionId && 
    selectedVehicleId === sessionVehicleId && 
    selectedSensorId === sessionSensorId;

  // Load data from API
  useEffect(() => {
    const initialize = async () => {
      try {
        // Load vehicles and sensors (database is already initialized in App.tsx)
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

  // Manual session creation handler
  const handleCreateSession = async () => {
    if (!selectedVehicleId || !selectedSensorId) {
      Alert.alert('Chyba', 'Vyberte vozidlo a senzor');
      return;
    }

    // If we're back to original configuration, ask user
    if (isOriginalConfiguration) {
      Alert.alert(
        'Session již existuje',
        'Pro tuto kombinaci vozidla a senzoru již existuje Session ID. Chcete použít existující, nebo vytvořit novou?',
        [
          { text: 'Zrušit', style: 'cancel' },
          {
            text: 'Použít existující',
            onPress: () => {
              // Just keep current session, no action needed
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

    // Otherwise create new session
    await createNewSession();
  };

  const createNewSession = async () => {
    if (!selectedVehicleId || !selectedSensorId) return;

    setIsLoading(true);
    try {
      const session = await ApiService.createSession(selectedVehicleId, selectedSensorId);
      setSessionId(session.id);
      setSessionVehicleId(selectedVehicleId);
      setSessionSensorId(selectedSensorId);
      console.log('✓ New session created:', session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
      setSessionId(null);
      Alert.alert('Chyba', 'Nepodařilo se vytvořit novou jízdu. Zkontrolujte připojení k serveru.');
    } finally {
      setIsLoading(false);
    }
  };

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
            onValueChange={(value) => setSelectedVehicleId(value)}
            enabled={true}
            style={{ color: 'black', backgroundColor: 'white' }}
            dropdownIconColor="black"
          >
            {vehicles.map(v => (
              <Picker.Item 
                key={v.id} 
                label={`${v.vehicle_name} (${v.width}cm)`} 
                value={v.id} 
                enabled={true}
                color={Platform.OS === 'android' ? 'black' : undefined}
              />
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
            style={{ color: 'black', backgroundColor: 'white' }}
            dropdownIconColor="black"
          >
            {sensors.map(s => (
              <Picker.Item 
                key={s.id} 
                label={s.description || `Senzor ${s.id}`} 
                value={s.id} 
                enabled={true}
                color={Platform.OS === 'android' ? 'black' : undefined}
              />
            ))}
          </Picker>
        ) : (
          <Text style={styles.errorText}>Žádné senzory k dispozici</Text>
        )}
      </Card>

      {/* Create Session Button */}
      <Button
        title={isLoading ? "Vytváření jízdy..." : "Vytvořit jízdu"}
        onPress={handleCreateSession}
        disabled={isLoading || !selectedVehicleId || !selectedSensorId}
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
  },
  errorText: {
    color: UIConfig.colors.destructive,
    fontSize: UIConfig.fontSize.sm,
  },
  infoText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
    marginTop: UIConfig.spacing.sm,
    textAlign: 'center',
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
