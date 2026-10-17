import { Alert, Platform } from 'react-native';

/**
 * Yes/no confirmation that works on every platform.
 * React Native Web implements Alert.alert as an empty function, so a plain Alert would silently
 * do nothing in the browser build; there window.confirm is used instead.
 */
export function confirmAsync(
  title: string,
  message: string,
  confirmLabel = 'Pokračovat',
  destructive = false
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const w = globalThis as unknown as { confirm?: (text: string) => boolean };
    return Promise.resolve(typeof w.confirm === 'function' ? w.confirm(`${title}\n\n${message}`) : true);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Zrušit', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
