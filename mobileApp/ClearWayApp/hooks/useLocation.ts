import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { MeasurementConfig } from '../config/measurement.config';

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
  const timestampsRef = useRef<number[]>([]);
  const metricsIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    let pollTimeoutId: NodeJS.Timeout | null = null;

    const pollLocation = async () => {
      if (cancelled || !enabled || !permissionGranted) {
        return;
      }

      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });

        if (cancelled) {
          return;
        }

        if (MeasurementConfig.enableLocationMetrics) {
          timestampsRef.current.push(Date.now());
        }

        setLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          accuracy: currentLocation.coords.accuracy,
          speed: currentLocation.coords.speed,
        });
      } catch (err) {
        console.error('Failed to get location:', err);
        setError('Failed to get location');
      } finally {
        if (!cancelled && enabled && permissionGranted) {
          pollTimeoutId = setTimeout(pollLocation, MeasurementConfig.locationTrackingIntervalMs);
        }
      }
    };

    const startTracking = async () => {
      if (!permissionGranted) {
        console.warn('Cannot start tracking: permission not granted');
        return;
      }

      console.log('🎯 Starting GPS tracking...');

      try {
        if (MeasurementConfig.preferPolling) {
          // Poll sequentially so only one GPS request is active at a time.
          pollLocation();
        } else {
          subscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.BestForNavigation,
              timeInterval: MeasurementConfig.locationTrackingIntervalMs,
              distanceInterval: 0,
            },
            (currentLocation) => {
              if (cancelled) {
                return;
              }

              // Record timestamp for metrics (if enabled)
              if (MeasurementConfig.enableLocationMetrics) {
                timestampsRef.current.push(Date.now());
              }

              setLocation({
                latitude: currentLocation.coords.latitude,
                longitude: currentLocation.coords.longitude,
                accuracy: currentLocation.coords.accuracy,
                speed: currentLocation.coords.speed,
              });
            }
          );
        }
      } catch (err) {
        console.error('Failed to start location tracking:', err);
        setError('Failed to get location');
      }
    };

    if (enabled && permissionGranted) {
      startTracking();
    }

    // If metrics are enabled, start periodic logger
    if (MeasurementConfig.enableLocationMetrics) {
      metricsIntervalRef.current = setInterval(() => {
        const now = Date.now();
        // Drop timestamps older than window
        const windowStart = now - MeasurementConfig.locationMetricsWindowMs;
        timestampsRef.current = timestampsRef.current.filter(ts => ts >= windowStart);
        const count = timestampsRef.current.length;
        const rate = (count / (MeasurementConfig.locationMetricsWindowMs / 1000));
        console.log(`📈 Location callbacks: ${count} in last ${MeasurementConfig.locationMetricsWindowMs}ms (${rate.toFixed(2)} Hz)`);
      }, MeasurementConfig.locationMetricsWindowMs);
    }

    // Cleanup
    return () => {
      cancelled = true;

      if (subscription) {
        subscription.remove();
      }

      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }

      if (metricsIntervalRef.current) {
        clearInterval(metricsIntervalRef.current);
        metricsIntervalRef.current = null;
      }
    };
  }, [enabled, permissionGranted]);

  return { location, error, permissionGranted };
};
