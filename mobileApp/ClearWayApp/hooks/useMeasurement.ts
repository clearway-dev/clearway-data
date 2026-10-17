import { useState, useRef, useCallback, useEffect } from 'react';
import { DatabaseService } from '../services/database.service';
import { useLocation } from './useLocation';
import { useBle } from '../contexts/BleContext';
import { MeasurementConfig } from '../config/measurement.config';
import { STATE_LABEL, TOO_CLOSE_STORED_CM, storedDistance } from '../services/merak/storage-policy';
import type { MeasurementSource } from '../services/merak/sensor-records';

interface LastMeasurement {
  distance_left: number;
  distance_right: number;
}

/** Where the stored distances come from. */
export type DataSource = 'merak' | 'simulation';

/**
 * Simulate distance sensors with anomalies for testing median filter
 * Type A: Single outlier (sensor noise) - one extreme value
 * Type B: Real obstacle - block of 3-5 lower values (parked car)
 */
const simulateDistances = (): { distance_left: number; distance_right: number } => {
  // Base normal value from config
  const baseLeft = MeasurementConfig.NORMAL_DISTANCE_MIN +
    Math.random() * (MeasurementConfig.NORMAL_DISTANCE_MAX - MeasurementConfig.NORMAL_DISTANCE_MIN);
  const baseRight = MeasurementConfig.NORMAL_DISTANCE_MIN +
    Math.random() * (MeasurementConfig.NORMAL_DISTANCE_MAX - MeasurementConfig.NORMAL_DISTANCE_MIN);

  // Randomly inject anomalies
  const rand = Math.random();

  // Type A: Configurable chance of single outlier (sensor noise)
  if (rand < MeasurementConfig.ANOMALY_TYPE_A_PROBABILITY) {
    const outlierLeft = MeasurementConfig.OUTLIER_LOW_MIN + Math.random() * (MeasurementConfig.OUTLIER_LOW_MAX - MeasurementConfig.OUTLIER_LOW_MIN);
    const outlierRight = MeasurementConfig.OUTLIER_LOW_MIN + Math.random() * (MeasurementConfig.OUTLIER_LOW_MAX - MeasurementConfig.OUTLIER_LOW_MIN);
    console.log('🔴 TYPE A ANOMALY: Single outlier', { left: outlierLeft, right: outlierRight });
    return {
      distance_left: outlierLeft,
      distance_right: outlierRight,
    };
  }

  // Type B: Configurable chance to START a real obstacle (parked car)
  // We'll use a ref-based counter outside this function via useState in useMeasurement
  return {
    distance_left: baseLeft,
    distance_right: baseRight,
  };
};

/**
 * @param source chosen on the START screen: 'merak' = distances from the connected measuring unit,
 *               'simulation' = built-in random test data. The source never changes during a measurement:
 *               a unit that drops out does not get replaced by simulated values.
 */
export const useMeasurement = (sessionId: string | null, source: MeasurementSource = 'simulation') => {
  const [isRecording, setIsRecording] = useState(false);
  const [measurementCount, setMeasurementCount] = useState(0);
  const [lastMeasurement, setLastMeasurement] = useState<LastMeasurement | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>('simulation');
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Obstacle counter for Type B anomalies
  const obstacleCounterRef = useRef(0);
  const inObstacleRef = useRef(false);

  // The measuring unit is read through a ref so start/stop keep a stable identity: the screen
  // auto-starts recording from an effect that depends on startRecording.
  const ble = useBle();
  const bleRef = useRef(ble);
  bleRef.current = ble;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Use location hook - only track when recording
  const { location, error: locationError, permissionGranted } = useLocation(isRecording);

  const startRecording = useCallback(() => {
    if (!sessionId) {
      console.error('Cannot start recording: no session ID');
      return;
    }

    if (!permissionGranted) {
      console.error('Cannot start recording: location permission not granted');
      return;
    }

    setIsRecording(true);
    setMeasurementCount(0);
    setSkippedCount(0);
    setDeviceWarning(null);

    // Start the measurement on the connected unit (A/R are re-sent first, M is verified).
    if (sourceRef.current === 'merak' && bleRef.current.status !== 'connected') {
      setDeviceWarning('Měřák není připojený. Připojte ho v Nastavit měření.');
    } else if (sourceRef.current === 'merak') {
      bleRef.current
        .startMeasurement()
        .then((ok) => {
          if (!ok) setDeviceWarning('Měřák se nepodařilo spustit');
        })
        .catch((e: unknown) => {
          setDeviceWarning(`Měřák se nepodařilo spustit: ${e instanceof Error ? e.message : String(e)}`);
        });
    }

    console.log('🎬 Recording started');
  }, [sessionId, permissionGranted]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (sourceRef.current === 'merak' && bleRef.current.status === 'connected') {
      bleRef.current.stopMeasurement().catch(() => {
        // the unit also stops measuring by itself when the link drops
      });
    }

    console.log(`⏹ Recording stopped (${measurementCount} measurements)`);
  }, [measurementCount]);

  // Leaving the screen must not leave the unit measuring.
  useEffect(() => {
    return () => {
      if (sourceRef.current === 'merak' && bleRef.current.status === 'connected') {
        bleRef.current.stopMeasurement().catch(() => {});
      }
    };
  }, []);

  // Save measurement when location updates
  useEffect(() => {
    if (isRecording && location && sessionId) {
      const saveMeasurement = async () => {
        try {
          let distances: LastMeasurement;
          const device = bleRef.current;

          if (sourceRef.current === 'merak') {
            setDataSource('merak');
            if (device.status !== 'connected') {
              setDeviceWarning('Měřák není připojený, vzorek neuložen');
              setSkippedCount((n) => n + 1);
              return;
            }
            // Real data from the measuring unit. The backend and the pipeline need a number on both
            // sides (distance_left + distance_right + vehicle width); what is stored per unit state is
            // decided in services/merak/storage-policy.ts. A side without a usable value skips the
            // sample (reported, never invented).
            const sides = device.getLatestSides();
            setDataSource('merak');
            if (!sides) {
              setDeviceWarning('Měřák neposílá aktuální data');
              setSkippedCount((n) => n + 1);
              return;
            }
            const left = storedDistance(sides.leftState, sides.left);
            const right = storedDistance(sides.rightState, sides.right);
            if (left === null || right === null) {
              const reasons = [
                left === null ? `levá: ${STATE_LABEL[sides.leftState]}` : null,
                right === null ? `pravá: ${STATE_LABEL[sides.rightState]}` : null,
              ]
                .filter(Boolean)
                .join(', ');
              setDeviceWarning(`Vzorek neuložen (${reasons})`);
              setSkippedCount((n) => n + 1);
              return;
            }
            distances = { distance_left: left, distance_right: right };
            const close = [
              sides.leftState === 'tooClose' ? 'levá' : null,
              sides.rightState === 'tooClose' ? 'pravá' : null,
            ].filter(Boolean);
            setDeviceWarning(
              close.length ? `PŘÍLIŠ BLÍZKO (${close.join(' a ')} strana), uloženo ${TOO_CLOSE_STORED_CM} cm` : null
            );
          } else {
            distances = simulateDistances();

            // Type B anomaly logic: Start obstacle with configurable chance
            if (!inObstacleRef.current && Math.random() < MeasurementConfig.ANOMALY_TYPE_B_PROBABILITY) {
              inObstacleRef.current = true;
              obstacleCounterRef.current = MeasurementConfig.OBSTACLE_DURATION_MIN +
                Math.floor(Math.random() * (MeasurementConfig.OBSTACLE_DURATION_MAX - MeasurementConfig.OBSTACLE_DURATION_MIN + 1));
              console.log('🟡 TYPE B ANOMALY START: Real obstacle for', obstacleCounterRef.current, 'measurements');
            }

            // If in obstacle, use lower values (parked car)
            if (inObstacleRef.current) {
              distances = {
                distance_left: MeasurementConfig.OBSTACLE_DISTANCE_MIN +
                  Math.random() * (MeasurementConfig.OBSTACLE_DISTANCE_MAX - MeasurementConfig.OBSTACLE_DISTANCE_MIN),
                distance_right: MeasurementConfig.OBSTACLE_DISTANCE_MIN +
                  Math.random() * (MeasurementConfig.OBSTACLE_DISTANCE_MAX - MeasurementConfig.OBSTACLE_DISTANCE_MIN),
              };

              obstacleCounterRef.current--;

              if (obstacleCounterRef.current <= 0) {
                inObstacleRef.current = false;
                console.log('🟢 TYPE B ANOMALY END: Obstacle cleared');
              }
            }
            setDataSource('simulation');
          }

          const { distance_left, distance_right } = distances;

          // Pass null when GPS doesn't report speed/accuracy rather than simulating values.
          const speed = location.speed != null && location.speed >= 0 ? location.speed : null;
          const accuracy_gps = location.accuracy ?? null;

              // Fire-and-forget insert to avoid blocking location callbacks.
              DatabaseService.insertMeasurement({
                session_id: sessionId,
                measured_at: new Date().toISOString(),
                latitude: location.latitude,
                longitude: location.longitude,
                distance_left,
                distance_right,
                speed,
                accuracy_gps,
              }).catch(err => console.error('Failed to insert measurement (async):', err));

              // Update UI counters immediately (DB insert happens in background)
              setLastMeasurement({ distance_left, distance_right });
              setMeasurementCount(prev => prev + 1);
        } catch (error) {
          console.error('Failed to save measurement:', error);
        }
      };

      saveMeasurement();
    }
  }, [isRecording, location, sessionId]);

  return {
    isRecording,
    measurementCount,
    currentLocation: location,
    locationError,
    permissionGranted,
    lastMeasurement,
    dataSource,
    deviceWarning,
    skippedCount,
    startRecording,
    stopRecording,
  };
};
