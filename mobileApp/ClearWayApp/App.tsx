import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { MeasurementScreen } from './screens/MeasurementScreen';

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <MeasurementScreen />
    </>
  );
}
