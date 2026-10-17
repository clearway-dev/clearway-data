import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getApiBaseUrl } from '../config/api.config';
import { friendlyLoginError } from '../services/auth-errors';

export const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { login } = useAuth();
  const apiUrl = getApiBaseUrl();

  // The message always stays visible on the screen. A native alert is added on top of it, but
  // never on the web: React Native Web has no real Alert, so there the inline message is the only
  // place the user can read what went wrong.
  const showError = (title: string, message: string) => {
    setErrorMessage(message);
    if (Platform.OS !== 'web') {
      Alert.alert(title, message);
    }
  };

  const handleLogin = async () => {
    setErrorMessage(null);

    if (!email.trim()) {
      showError('Chyba', 'Zadejte prosím email');
      return;
    }

    if (!password.trim()) {
      showError('Chyba', 'Zadejte prosím heslo');
      return;
    }

    setIsLoading(true);

    try {
      await login(email.trim(), password);
    } catch (error) {
      console.error('Login error:', error);
      showError('Chyba přihlášení', friendlyLoginError(error, apiUrl));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.logo}>🛣️</Text>
            <Text style={styles.title}>ClearWay</Text>
            <Text style={styles.subtitle}>Mobilní měření dat</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                testID="emailInput"
                style={styles.input}
                placeholder="vas@email.cz"
                placeholderTextColor="#a1a1aa"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!isLoading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Heslo</Text>
              <TextInput
                testID="passwordInput"
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#a1a1aa"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onSubmitEditing={handleLogin}
              />
            </View>

            {errorMessage ? (
              <View style={styles.errorBox} testID="loginError" accessibilityRole="alert">
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              testID="loginButton"
              style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>Přihlásit se</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Pro přístup k aplikaci je nutné platné přihlášení
            </Text>
            <Text style={styles.serverText} testID="serverUrl">
              Server: {apiUrl}
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#18181b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#71717a',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#18181b',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c',
    lineHeight: 20,
  },
  loginButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  footer: {
    marginTop: 48,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 20,
  },
  serverText: {
    marginTop: 12,
    fontSize: 12,
    color: '#a1a1aa',
    textAlign: 'center',
  },
});
