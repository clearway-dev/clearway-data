import { useState, useRef, useCallback, useEffect } from 'react';
import { DatabaseService } from '../services/database.service';
import { useLocation } from './useLocation';

/**
 * Simulate distance sensors
 * In real app, this would read from hardware sensors
 */
const simulateDistances = () => {
  return {
    distance_left: Math.random() * 400 + 100,  // 100-500 cm
    distance_right: Math.random() * 400 + 100,
  };
};

export const useMeasurement = (sessionId: string | null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [measurementCount, setMeasurementCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
          const { distance_left, distance_right } = simulateDistances();

          await DatabaseService.insertMeasurement({
            session_id: sessionId,
            measured_at: new Date().toISOString(),
            latitude: location.latitude,
            longitude: location.longitude,
            distance_left,
            distance_right,
          });

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
    startRecording,
    stopRecording,
  };
};
