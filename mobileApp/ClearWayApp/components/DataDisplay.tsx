import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from './ui/Card';
import { Text } from './ui/Text';

export interface MeasurementData {
  latitude: number;
  longitude: number;
  left_width: number;
  right_width: number;
  timestamp: string;
}

interface DataDisplayProps {
  data: MeasurementData;
}

export const DataDisplay: React.FC<DataDisplayProps> = ({ data }) => {
  return (
    <Card style={styles.container}>
      <Text variant="h3" style={styles.title}>
        Testovací data měření
      </Text>
      
      <View style={styles.dataRow}>
        <Text variant="label">Latitude:</Text>
        <Text variant="body" style={styles.value}>{data.latitude}°</Text>
      </View>
      
      <View style={styles.dataRow}>
        <Text variant="label">Longitude:</Text>
        <Text variant="body" style={styles.value}>{data.longitude}°</Text>
      </View>
      
      <View style={styles.dataRow}>
        <Text variant="label">Šířka vlevo:</Text>
        <Text variant="body" style={styles.value}>{data.left_width} m</Text>
      </View>
      
      <View style={styles.dataRow}>
        <Text variant="label">Šířka vpravo:</Text>
        <Text variant="body" style={styles.value}>{data.right_width} m</Text>
      </View>
      
      <View style={styles.dataRow}>
        <Text variant="label">Timestamp:</Text>
        <Text variant="body" style={styles.value}>{data.timestamp}</Text>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  title: {
    marginBottom: 20,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
  },
  value: {
    fontWeight: '600',
    color: '#18181b',
  },
});
