import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { BackendStatusBar } from '../components/BackendStatusBar';
import { useMeasurement } from '../hooks/useMeasurement';
import { useSync } from '../hooks/useSync';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types/navigation';

type MeasurementScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Measurement'>;
type MeasurementScreenRouteProp = RouteProp<RootStackParamList, 'Measurement'>;

interface Props {
  navigation: MeasurementScreenNavigationProp;
  route: MeasurementScreenRouteProp;
}

export const MeasurementScreen: React.FC<Props> = ({ navigation, route }) => {
  const { sessionId } = route.params;
  const [isPaused, setIsPaused] = useState(false);

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
  // For now, assume vehicle width is ~180cm (will be from vehicle data later)
  const getStreetWidth = () => {
    if (!lastMeasurement) return null;
    // Convert cm to meters for display
    const widthCm = lastMeasurement.distance_left + lastMeasurement.distance_right + 180;
    return widthCm / 100;
  };

  const getWidthColor = (widthM: number | null) => {
    if (widthM === null) return '#71717a';
    if (widthM > 3.5) return '#22c55e'; // Green
    if (widthM >= 3.0) return '#eab308'; // Yellow
    return '#ef4444'; // Red
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
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Měření</Text>

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
            <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.legendText}>&gt; 3.5m - Zelená</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#eab308' }]} />
            <Text style={styles.legendText}>3.0 - 3.5m - Žlutá</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.legendText}>&lt; 3.0m - Červená</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  scrollView: {
    flex: 1,
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
  widthCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e4e4e7',
  },
  widthLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#71717a',
    marginBottom: 12,
  },
  widthDisplay: {
    alignItems: 'center',
    marginBottom: 16,
  },
  widthValue: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  widthIndicator: {
    width: '100%',
    height: 8,
    borderRadius: 4,
  },
  distanceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  distanceText: {
    fontSize: 14,
    color: '#71717a',
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
    fontSize: 14,
  },
  controlButton: {
    marginVertical: 8,
    paddingVertical: 16,
  },
  syncButton: {
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  legendDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 8,
  },
  legendText: {
    fontSize: 14,
    color: '#18181b',
  },
});
