import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomHeader } from '../components/ui/CustomHeader';
import { MerakConnectCard } from '../components/merak/MerakConnectCard';
import { UIConfig } from '../config/ui.config';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'MerakSetup'>;

interface Props {
  navigation: Navigation;
}

/**
 * Own page for setting up the measurement: Bluetooth connection of the measuring unit, the data
 * mode (MIN / RAW), the firmware generation and the link to the service screen.
 */
export const MerakSetupScreen: React.FC<Props> = ({ navigation }) => (
  <View style={styles.container}>
    <CustomHeader title="Nastavit měření" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <MerakConnectCard onOpenService={() => navigation.navigate('MerakService')} />
    </ScrollView>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UIConfig.colors.background,
  },
  content: {
    alignItems: 'center',
    padding: UIConfig.spacing.xl,
    paddingBottom: UIConfig.spacing.xxxl,
  },
});
