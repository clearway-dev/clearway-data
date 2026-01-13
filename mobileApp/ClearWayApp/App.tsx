import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, ScrollView, Alert } from 'react-native';
import { DataDisplay, MeasurementData } from './components/DataDisplay';
import { Button } from './components/ui/Button';
import { Text } from './components/ui/Text';
import { sendMeasurementData } from './services/api';

// Static test data
const testData: MeasurementData = {
  latitude: 49.8175,
  longitude: 15.4730,
  left_width: 2.5,
  right_width: 2.8,
  timestamp: new Date().toISOString(),
};

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSendData = async () => {
    setIsLoading(true);
    setStatusMessage(null);

    const result = await sendMeasurementData(testData);

    setIsLoading(false);

    if (result.success) {
      setStatusMessage('✓ ' + result.message);
      // Optional: Show native alert
      Alert.alert('Úspěch', result.message);
    } else {
      setStatusMessage('✗ ' + result.message);
      Alert.alert('Chyba', result.message + (result.error ? `\n${result.error}` : ''));
    }

    // Clear status message after 5 seconds
    setTimeout(() => setStatusMessage(null), 5000);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text variant="h1">ClearWay</Text>
          <Text variant="label" style={styles.subtitle}>
            Proof of Concept
          </Text>
        </View>

        <DataDisplay data={testData} />

        <Button
          title="Odeslat data"
          onPress={handleSendData}
          loading={isLoading}
          disabled={isLoading}
          style={styles.button}
        />

        {statusMessage && (
          <View style={[
            styles.statusMessage,
            statusMessage.startsWith('✓') ? styles.successMessage : styles.errorMessage
          ]}>
            <Text variant="body" style={styles.statusText}>
              {statusMessage}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 4,
  },
  button: {
    marginTop: 24,
  },
  statusMessage: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  successMessage: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  errorMessage: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  statusText: {
    textAlign: 'center',
  },
});
