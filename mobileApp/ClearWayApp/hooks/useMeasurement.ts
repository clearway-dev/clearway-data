import { useState, useRef, useCallback, useEffect } from 'react';
import { DatabaseService } from '../services/database.service';
import { useLocation } from './useLocation';

interface LastMeasurement {
  distance_left: number;
  distance_right: number;
}

/**
 * Simulate distance sensors with anomalies for testing median filter
 * Type A: Single outlier (sensor noise) - one extreme value
 * Type B: Real obstacle - block of 3-5 lower values (parked car)
 */
const simulateDistances = (): { distance_left: number; distance_right: number } => {
  // Base normal value around 300cm
  const baseLeft = 290 + Math.random() * 20; // 290-310cm
  const baseRight = 290 + Math.random() * 20;

  // Randomly inject anomalies
  const rand = Math.random();

  // Type A: 5% chance of single outlier (sensor noise)
  if (rand < 0.05) {
    const isExtremeLow = Math.random() < 0.5;
    const outlierLeft = isExtremeLow ? 45 + Math.random() * 50 : 550 + Math.random() * 50;
    const outlierRight = isExtremeLow ? 45 + Math.random() * 50 : 550 + Math.random() * 50;
    
    console.log('🔴 TYPE A ANOMALY: Single outlier', { left: outlierLeft, right: outlierRight });
    return {
      distance_left: outlierLeft,
      distance_right: outlierRight,
    };
  }

  // Type B: 3% chance to START a real obstacle (parked car)
  // We'll use a ref-based counter outside this function via useState in useMeasurement
  return {
    distance_left: baseLeft,
    distance_right: baseRight,
  };
};

// ❌ VYPNUTO: Simulace speed a accuracy - používáme jen reálná GPS data
// const simulateSpeed = () => {
//   // 5-15 m/s (~18-54 km/h) for realistic city driving simulation
//   return Math.random() * 10 + 5;
// };

// const simulateGpsAccuracy = () => {
//   // Typical mobile GPS horizontal accuracy in meters
//   return Math.random() * 12 + 3;
// };

export const useMeasurement = (sessionId: string | null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [measurementCount, setMeasurementCount] = useState(0);
  const [lastMeasurement, setLastMeasurement] = useState<LastMeasurement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Obstacle counter for Type B anomalies
  const obstacleCounterRef = useRef(0);
  const inObstacleRef = useRef(false);

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
    
    console.log('🎬 Recording started');
  }, [sessionId, permissionGranted]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    console.log(`⏹ Recording stopped (${measurementCount} measurements)`);
  }, [measurementCount]);

  // Save measurement when location updates
  useEffect(() => {
    if (isRecording && location && sessionId) {
      const saveMeasurement = async () => {
        try {
          let distances = simulateDistances();
          
          // Type B anomaly logic: Start obstacle with 3% chance
          if (!inObstacleRef.current && Math.random() < 0.03) {
            inObstacleRef.current = true;
            obstacleCounterRef.current = 3 + Math.floor(Math.random() * 3); // 3-5 measurements
            console.log('🟡 TYPE B ANOMALY START: Real obstacle for', obstacleCounterRef.current, 'measurements');
          }

          // If in obstacle, use lower values (parked car)
          if (inObstacleRef.current) {
            distances = {
              distance_left: 190 + Math.random() * 40, // 190-230cm
              distance_right: 190 + Math.random() * 40,
            };
            
            obstacleCounterRef.current--;
            
            if (obstacleCounterRef.current <= 0) {
              inObstacleRef.current = false;
              console.log('🟢 TYPE B ANOMALY END: Obstacle cleared');
            }
          }

          const { distance_left, distance_right } = distances;
          
          // ❌ VYPNUTO: Simulace rychlosti a přesnosti - používáme jen reálná data z GPS
          // const speed = location.speed != null && location.speed >= 0 ? location.speed : simulateSpeed();
          // const accuracy_gps = location.accuracy ?? simulateGpsAccuracy();
          
          // ✅ Posílat pouze reálné hodnoty z GPS (může být null/undefined)
          const speed = location.speed != null && location.speed >= 0 ? location.speed : null;
          const accuracy_gps = location.accuracy ?? null;

          await DatabaseService.insertMeasurement({
            session_id: sessionId,
            measured_at: new Date().toISOString(),
            latitude: location.latitude,
            longitude: location.longitude,
            distance_left,
            distance_right,
            speed,
            accuracy_gps,
          });

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
    startRecording,
    stopRecording,
  };
};
