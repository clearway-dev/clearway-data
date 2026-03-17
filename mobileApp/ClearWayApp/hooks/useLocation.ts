import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
}

export const useLocation = (enabled: boolean) => {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);

  // Request permission immediately on mount
  useEffect(() => {
    const requestPermission = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== 'granted') {
          setError('Permission to access location was denied');
          setPermissionGranted(false);
          return;
        }

        setPermissionGranted(true);
        setError(null);
        console.log('✓ Location permission granted');
      } catch (err) {
        setError('Failed to request location permission');
        console.error(err);
      }
    };

    requestPermission();
  }, []); // Run only once on mount

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const startTracking = async () => {
      if (!permissionGranted) {
        console.warn('Cannot start tracking: permission not granted');
        return;
      }

      console.log('🎯 Starting GPS tracking...');
      
      // Read GPS every 1 second (regardless of movement)
      intervalId = setInterval(async () => {
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          });

          setLocation({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
            accuracy: currentLocation.coords.accuracy,
            speed: currentLocation.coords.speed,
          });
        } catch (err) {
          console.error('Failed to get location:', err);
          setError('Failed to get location');
        }
      }, 1000); // 1 second interval
    };

    if (enabled && permissionGranted) {
      startTracking();
    }

    // Cleanup
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [enabled, permissionGranted]);

  return { location, error, permissionGranted };
};
