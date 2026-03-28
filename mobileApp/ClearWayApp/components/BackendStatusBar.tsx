import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SyncService } from '../services/sync.service';
import { SyncStatus } from '../types/navigation';

export const BackendStatusBar: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>({ status: 'idle' });
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    const unsubscribe = SyncService.subscribe((newStatus) => {
      setStatus(newStatus);

      // Show bar with fade in
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        // Auto-hide success/error after 3 seconds
        Animated.delay(3000),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (status.status === 'idle') {
    return null;
  }

  const getStatusStyle = () => {
    switch (status.status) {
      case 'syncing':
        return styles.syncing;
      case 'success':
        return styles.success;
      case 'error':
        return styles.error;
      default:
        return {};
    }
  };

  const getStatusIcon = () => {
    switch (status.status) {
      case 'syncing':
        return '⟳';
      case 'success':
        return '✓';
      case 'error':
        return '⚠';
      default:
        return '';
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        getStatusStyle(),
        { opacity: fadeAnim }
      ]}
    >
      <Text style={styles.icon}>{getStatusIcon()}</Text>
      <Text style={styles.message}>{status.message || 'Probíhá synchronizace...'}</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 1000,
  },
  syncing: {
    backgroundColor: '#3b82f6',
  },
  success: {
    backgroundColor: '#22c55e',
  },
  error: {
    backgroundColor: '#ef4444',
  },
  icon: {
    fontSize: 18,
    color: '#fff',
    marginRight: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
});
