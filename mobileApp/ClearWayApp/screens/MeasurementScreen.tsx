import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, AppState, AppStateStatus } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CustomHeader } from '../components/ui/CustomHeader';
import { BackendStatusBar } from '../components/BackendStatusBar';
import { useMeasurement } from '../hooks/useMeasurement';
import { useSync } from '../hooks/useSync';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types/navigation';
import { UIConfig } from '../config/ui.config';
import { MeasurementConfig } from '../config/measurement.config';

type MeasurementScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Measurement'>;
type MeasurementScreenRouteProp = RouteProp<RootStackParamList, 'Measurement'>;

interface Props {
  navigation: MeasurementScreenNavigationProp;
  route: MeasurementScreenRouteProp;
}

export const MeasurementScreen: React.FC<Props> = ({ navigation, route }) => {
  const { sessionId } = route.params;
  const [isPaused, setIsPaused] = useState(false);
  const [systemPaused, setSystemPaused] = useState(false); // Flag pro systémovou pauzu
  const appState = useRef(AppState.currentState);

  // Hooks
  const { 
    isRecording, 
    measurementCount, 
    currentLocation, 
    locationError, 
    permissionGranted,
    lastMeasurement,
    startRecording, 
    stopRecording 
  } = useMeasurement(sessionId);
  
  const { stats, forceSync } = useSync(isRecording);

  // Keep screen awake when recording
  React.useEffect(() => {
    if (isRecording && !isPaused) {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }

    return () => {
      deactivateKeepAwake();
    };
  }, [isRecording, isPaused]);

  // Handle app going to background (incoming call, app switch, etc.)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      console.log('AppState changed:', appState.current, '->', nextAppState);
      
      // Aplikace přechází do pozadí BĚHEM aktivního měření
      if (
        appState.current === 'active' &&
        (nextAppState === 'background' || nextAppState === 'inactive') &&
        isRecording &&
        !isPaused
      ) {
        console.warn('⚠️ App going to background during active measurement - auto-pausing');
        stopRecording();
        setIsPaused(true);
        setSystemPaused(true); // Označit, že pauza byla systémová
      }
      
      // Aplikace se vrací do popředí
      if (
        (appState.current === 'background' || appState.current === 'inactive') &&
        nextAppState === 'active' &&
        systemPaused
      ) {
        console.log('✓ App returned to foreground - measurement paused by system');
        // Uživatel se vrátil - zobrazíme alert, že měření bylo pozastaveno
        Alert.alert(
          'Měření pozastaveno',
          'Měření bylo automaticky pozastaveno při odchodu aplikace na pozadí. Spusťte měření znovu tlačítkem "Pokračovat".',
          [{ text: 'OK' }]
        );
        setSystemPaused(false); // Reset flagu
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isRecording, isPaused, systemPaused, stopRecording]);

  // Auto-start recording when screen loads
  React.useEffect(() => {
    if (permissionGranted && !isRecording) {
      startRecording();
    }
  }, [permissionGranted]);

  const handleTogglePause = () => {
    if (isPaused) {
      // Resume
      startRecording();
      setIsPaused(false);
    } else {
      // Pause
      stopRecording();
      setIsPaused(true);
    }
  };

  const handleClose = () => {
    if (isRecording || isPaused) {
      Alert.alert(
        'Ukončit měření?',
        'Opravdu chcete ukončit měření? Všechna neodeslaná data budou synchronizována na server.',
        [
          { text: 'Zrušit', style: 'cancel' },
          {
            text: 'Ukončit',
            style: 'destructive',
            onPress: () => {
              stopRecording();
              navigation.navigate('Setup');
            },
          },
        ]
      );
    } else {
      navigation.navigate('Setup');
    }
  };

  // Calculate street width from last measurement (distance_left + distance_right + vehicle_width)
  const getStreetWidth = () => {
    if (!lastMeasurement) return null;
    // Convert cm to meters for display
    const widthCm = lastMeasurement.distance_left + lastMeasurement.distance_right + MeasurementConfig.vehicle.defaultWidthCm;
    return widthCm / 100;
  };

  const getWidthColor = (widthM: number | null) => {
    if (widthM === null) return UIConfig.colors.mutedForeground;
    if (widthM > MeasurementConfig.widthThresholds.greenMinMeters) return MeasurementConfig.widthThresholds.colors.green;
    if (widthM >= MeasurementConfig.widthThresholds.yellowMinMeters) return MeasurementConfig.widthThresholds.colors.yellow;
    return MeasurementConfig.widthThresholds.colors.red;
  };

  const streetWidth = getStreetWidth();
  const widthColor = getWidthColor(streetWidth);

  if (!permissionGranted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Aplikace nemá oprávnění k poloze</Text>
        <Button title="Zavřít" onPress={handleClose} variant="secondary" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BackendStatusBar />
      
      <CustomHeader variant="close" onClose={handleClose} title="Měření" />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* Current Width Display */}
        <Card style={[styles.card, styles.widthCard]}>
          <Text style={styles.widthLabel}>Aktuální šířka:</Text>
          {streetWidth !== null ? (
            <View style={styles.widthDisplay}>
              <Text style={[styles.widthValue, { color: widthColor }]}>
                {streetWidth.toFixed(2)} m
              </Text>
              <View style={[styles.widthIndicator, { backgroundColor: widthColor }]} />
            </View>
          ) : (
            <Text style={styles.widthValue}>--</Text>
          )}
          
          {lastMeasurement && (
            <View style={styles.distanceDetails}>
              <Text style={styles.distanceText}>
                Levá: {(lastMeasurement.distance_left / 100).toFixed(2)}m
              </Text>
              <Text style={styles.distanceText}>
                Pravá: {(lastMeasurement.distance_right / 100).toFixed(2)}m
              </Text>
            </View>
          )}
        </Card>

        {/* Status */}
        <Card style={styles.card}>
          <Text style={styles.label}>
            Status: {isRecording ? '🔴 Nahrávání...' : isPaused ? '⏸ Pozastaveno' : 'Připraveno'}
          </Text>
          <Text style={styles.value}>Měření: {measurementCount}</Text>
        </Card>

        {/* Location Info */}
        {locationError && (
          <Card style={[styles.card, styles.errorCard]}>
            <Text style={styles.errorText}>{locationError}</Text>
          </Card>
        )}

        {currentLocation && (
          <Card style={styles.card}>
            <Text style={styles.label}>GPS pozice:</Text>
            <Text style={styles.value}>Lat: {currentLocation.latitude.toFixed(6)}°</Text>
            <Text style={styles.value}>Lon: {currentLocation.longitude.toFixed(6)}°</Text>
            {currentLocation.accuracy && (
              <Text style={styles.value}>Přesnost: {currentLocation.accuracy.toFixed(1)}m</Text>
            )}
          </Card>
        )}

        {/* Controls */}
        <Button
          title={isPaused ? 'Pokračovat' : 'Stop'}
          onPress={handleTogglePause}
          variant={isPaused ? 'primary' : 'secondary'}
          style={styles.controlButton}
        />

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

        {/* Color Legend */}
        <Card style={styles.card}>
          <Text style={styles.label}>Legenda barev:</Text>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: MeasurementConfig.widthThresholds.colors.green }]} />
            <Text style={styles.legendText}>&gt; {MeasurementConfig.widthThresholds.greenMinMeters}m - Zelená</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: MeasurementConfig.widthThresholds.colors.yellow }]} />
            <Text style={styles.legendText}>{MeasurementConfig.widthThresholds.yellowMinMeters} - {MeasurementConfig.widthThresholds.greenMinMeters}m - Žlutá</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: MeasurementConfig.widthThresholds.colors.red }]} />
            <Text style={styles.legendText}>&lt; {MeasurementConfig.widthThresholds.yellowMinMeters}m - Červená</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UIConfig.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: UIConfig.spacing.xl,
  },
  card: {
    marginBottom: UIConfig.spacing.lg,
  },
  widthCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: UIConfig.colors.border,
  },
  widthLabel: {
    fontSize: UIConfig.fontSize.md,
    fontWeight: '500',
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.md,
  },
  widthDisplay: {
    alignItems: 'center',
    marginBottom: UIConfig.spacing.lg,
  },
  widthValue: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: UIConfig.spacing.sm,
  },
  widthIndicator: {
    width: '100%',
    height: 8,
    borderRadius: UIConfig.borderRadius.sm,
  },
  distanceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: UIConfig.spacing.sm,
  },
  distanceText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.mutedForeground,
  },
  label: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '500',
    color: UIConfig.colors.mutedForeground,
    marginBottom: UIConfig.spacing.sm,
  },
  value: {
    fontSize: UIConfig.fontSize.md,
    color: UIConfig.colors.foreground,
    marginBottom: UIConfig.spacing.xs,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  errorText: {
    color: UIConfig.colors.destructive,
    fontSize: UIConfig.fontSize.sm,
  },
  controlButton: {
    marginVertical: UIConfig.spacing.sm,
    paddingVertical: UIConfig.spacing.lg,
  },
  syncButton: {
    marginTop: UIConfig.spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: UIConfig.spacing.xs,
  },
  legendDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: UIConfig.spacing.sm,
  },
  legendText: {
    fontSize: UIConfig.fontSize.sm,
    color: UIConfig.colors.foreground,
  },
});
