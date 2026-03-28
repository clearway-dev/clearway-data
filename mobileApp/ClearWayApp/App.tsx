import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { HomeScreen } from './screens/HomeScreen';
import { SetupScreen } from './screens/SetupScreen';
import { MeasurementScreen } from './screens/MeasurementScreen';
import { RootStackParamList } from './types/navigation';
import { DatabaseService } from './services/database.service';
import { SyncService } from './services/sync.service';
import { SyncConfig } from './config/sync.config';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [zombieSyncInfo, setZombieSyncInfo] = useState<string>('Inicializace...');

  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('🚀 Initializing application...');
        
        // 1. Initialize database
        setZombieSyncInfo('Inicializace databáze...');
        await DatabaseService.initialize();
        console.log('✓ Database initialized');
        
        // 2. Check for unsynced measurements before Zombie Sync
        const statsBeforeSync = await DatabaseService.getStats();
        
        if (statsBeforeSync.unsynced > 0) {
          console.log(`🧟 Found ${statsBeforeSync.unsynced} unsynced measurements from previous session`);
          
          // Check if we need multiple batches
          const batchCount = Math.ceil(statsBeforeSync.unsynced / SyncConfig.MAX_BATCH_SIZE);
          
          if (batchCount > 1) {
            setZombieSyncInfo(`Odesílám ${statsBeforeSync.unsynced} měření (${batchCount} dávek)...`);
          } else {
            setZombieSyncInfo(`Odesílám ${statsBeforeSync.unsynced} neuložených měření...`);
          }
          
          // Run Zombie Sync (sends up to MAX_BATCH_SIZE)
          await SyncService.syncOnce();
          
          // Check how many were synced
          const statsAfterSync = await DatabaseService.getStats();
          const synced = statsBeforeSync.unsynced - statsAfterSync.unsynced;
          
          if (synced > 0) {
            console.log(`✓ Zombie Sync: ${synced} measurements synced successfully`);
            
            if (statsAfterSync.unsynced > 0) {
              // More data remaining
              setZombieSyncInfo(`✓ Odesláno ${synced} měření. Zbývá ${statsAfterSync.unsynced} (automaticky se odešle na pozadí)`);
              await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
              // All synced
              setZombieSyncInfo(`✓ Odesláno ${synced} měření z předchozí relace`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } else {
            console.log('⚠️ Zombie Sync: Failed to sync measurements (server might be unavailable)');
            setZombieSyncInfo('⚠️ Server nedostupný - data zůstávají uložena lokálně');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          console.log('✓ No unsynced measurements found');
          setZombieSyncInfo('Vše synchronizováno');
        }
        
        setIsInitialized(true);
      } catch (error) {
        console.error('❌ Failed to initialize app:', error);
        setInitError(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    initializeApp();
  }, []);

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingTitle}>Clearway</Text>
        <ActivityIndicator size="large" color="#18181b" style={styles.spinner} />
        <Text style={styles.loadingText}>
          {initError ? `Chyba: ${initError}` : zombieSyncInfo}
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#fafafa' },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Setup" component={SetupScreen} />
        <Stack.Screen name="Measurement" component={MeasurementScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#fafafa',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingTitle: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#18181b',
    marginBottom: 40,
  },
  spinner: {
    marginVertical: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
  },
});

