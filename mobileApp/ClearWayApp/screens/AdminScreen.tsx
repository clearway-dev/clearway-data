import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { ApiService } from '../services/api.service';

type AdminScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Admin'>;

interface Props {
  navigation: AdminScreenNavigationProp;
}

interface VehicleFormData {
  vehicle_name: string;
  width: string;
}

interface SensorFormData {
  description: string;
}

interface FormErrors {
  vehicle_name?: string;
  width?: string;
  description?: string;
}

export const AdminScreen: React.FC<Props> = ({ navigation }) => {
  // Vehicle form state
  const [vehicleForm, setVehicleForm] = useState<VehicleFormData>({
    vehicle_name: '',
    width: '',
  });
  const [vehicleErrors, setVehicleErrors] = useState<FormErrors>({});
  const [isCreatingVehicle, setIsCreatingVehicle] = useState(false);

  // Sensor form state
  const [sensorForm, setSensorForm] = useState<SensorFormData>({
    description: '',
  });
  const [sensorErrors, setSensorErrors] = useState<FormErrors>({});
  const [isCreatingSensor, setIsCreatingSensor] = useState(false);

  // Vehicle validation
  const validateVehicle = (): boolean => {
    const errors: FormErrors = {};
    const trimmedName = vehicleForm.vehicle_name.trim();
    const widthNum = parseFloat(vehicleForm.width);

    if (!trimmedName) {
      errors.vehicle_name = 'Název vozidla je povinný';
    } else if (trimmedName.length < 2) {
      errors.vehicle_name = 'Název musí mít alespoň 2 znaky';
    } else if (trimmedName.length > 100) {
      errors.vehicle_name = 'Název může mít maximálně 100 znaků';
    }

    if (!vehicleForm.width) {
      errors.width = 'Šířka je povinná';
    } else if (isNaN(widthNum)) {
      errors.width = 'Šířka musí být číslo';
    } else if (widthNum <= 0) {
      errors.width = 'Šířka musí být větší než 0';
    } else if (widthNum > 10000) {
      errors.width = 'Šířka musí být menší než 10000';
    }

    setVehicleErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Sensor validation
  const validateSensor = (): boolean => {
    const errors: FormErrors = {};
    const trimmedDescription = sensorForm.description.trim();

    if (!trimmedDescription) {
      errors.description = 'Popis senzoru je povinný';
    } else if (trimmedDescription.length < 2) {
      errors.description = 'Popis musí mít alespoň 2 znaky';
    } else if (trimmedDescription.length > 255) {
      errors.description = 'Popis může mít maximálně 255 znaků';
    }

    setSensorErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle vehicle creation
  const handleCreateVehicle = async () => {
    if (!validateVehicle()) {
      return;
    }

    setIsCreatingVehicle(true);
    try {
      await ApiService.createVehicle({
        vehicle_name: vehicleForm.vehicle_name.trim(),
        width: parseFloat(vehicleForm.width),
      });

      Alert.alert('Úspěch', 'Vozidlo bylo úspěšně vytvořeno');
      setVehicleForm({ vehicle_name: '', width: '' });
      setVehicleErrors({});
    } catch (error: any) {
      console.error('Failed to create vehicle:', error);
      Alert.alert(
        'Chyba',
        error.message || 'Nepodařilo se vytvořit vozidlo'
      );
    } finally {
      setIsCreatingVehicle(false);
    }
  };

  // Handle sensor creation
  const handleCreateSensor = async () => {
    if (!validateSensor()) {
      return;
    }

    setIsCreatingSensor(true);
    try {
      await ApiService.createSensor({
        description: sensorForm.description.trim(),
        is_active: true,
      });

      Alert.alert('Úspěch', 'Senzor byl úspěšně vytvořen');
      setSensorForm({ description: '' });
      setSensorErrors({});
    } catch (error: any) {
      console.error('Failed to create sensor:', error);
      Alert.alert(
        'Chyba',
        error.message || 'Nepodařilo se vytvořit senzor'
      );
    } finally {
      setIsCreatingSensor(false);
    }
  };

  const isVehicleFormValid = () => {
    const trimmedName = vehicleForm.vehicle_name.trim();
    const widthNum = parseFloat(vehicleForm.width);
    return (
      trimmedName.length >= 2 &&
      trimmedName.length <= 100 &&
      !isNaN(widthNum) &&
      widthNum > 0 &&
      widthNum <= 10000
    );
  };

  const isSensorFormValid = () => {
    const trimmedDescription = sensorForm.description.trim();
    return trimmedDescription.length >= 2 && trimmedDescription.length <= 255;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>← Zpět</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Admin Panel</Text>
        </View>

        {/* Vehicle Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vytvořit vozidlo</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Název vozidla *</Text>
            <TextInput
              style={[
                styles.input,
                vehicleErrors.vehicle_name && styles.inputError,
              ]}
              placeholder="např. Auto"
              value={vehicleForm.vehicle_name}
              onChangeText={(text) => {
                setVehicleForm({ ...vehicleForm, vehicle_name: text });
                if (vehicleErrors.vehicle_name) {
                  setVehicleErrors({ ...vehicleErrors, vehicle_name: undefined });
                }
              }}
              editable={!isCreatingVehicle}
            />
            {vehicleErrors.vehicle_name && (
              <Text style={styles.errorText}>{vehicleErrors.vehicle_name}</Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Šířka (cm) *</Text>
            <TextInput
              style={[styles.input, vehicleErrors.width && styles.inputError]}
              placeholder="např. 180"
              value={vehicleForm.width}
              onChangeText={(text) => {
                setVehicleForm({ ...vehicleForm, width: text });
                if (vehicleErrors.width) {
                  setVehicleErrors({ ...vehicleErrors, width: undefined });
                }
              }}
              keyboardType="numeric"
              editable={!isCreatingVehicle}
            />
            {vehicleErrors.width && (
              <Text style={styles.errorText}>{vehicleErrors.width}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              (!isVehicleFormValid() || isCreatingVehicle) &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleCreateVehicle}
            disabled={!isVehicleFormValid() || isCreatingVehicle}
          >
            {isCreatingVehicle ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Vytvořit vozidlo</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Sensor Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vytvořit senzor</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Popis senzoru *</Text>
            <TextInput
              style={[
                styles.input,
                sensorErrors.description && styles.inputError,
              ]}
              placeholder="např. HC-SR04 Ultrazvukový senzor"
              value={sensorForm.description}
              onChangeText={(text) => {
                setSensorForm({ ...sensorForm, description: text });
                if (sensorErrors.description) {
                  setSensorErrors({ ...sensorErrors, description: undefined });
                }
              }}
              editable={!isCreatingSensor}
              multiline
              numberOfLines={2}
            />
            {sensorErrors.description && (
              <Text style={styles.errorText}>{sensorErrors.description}</Text>
            )}
            <Text style={styles.helperText}>
              Senzor bude automaticky nastaven jako aktivní
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              (!isSensorFormValid() || isCreatingSensor) &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleCreateSensor}
            disabled={!isSensorFormValid() || isCreatingSensor}
          >
            {isCreatingSensor ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Vytvořit senzor</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 50,
  },
  header: {
    marginBottom: 30,
  },
  backButton: {
    marginBottom: 15,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#18181b',
  },
  section: {
    marginBottom: 40,
    padding: 20,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#18181b',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#18181b',
  },
  inputError: {
    borderColor: '#dc2626',
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
