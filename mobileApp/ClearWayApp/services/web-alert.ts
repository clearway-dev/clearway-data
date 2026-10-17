import { Alert, AlertButton, Platform } from 'react-native';

/**
 * React Native Web implements Alert.alert as an empty function, so every error and confirmation
 * dialog of the app (failed login, logout confirmation, upload errors, ...) silently does nothing
 * in a browser. This maps Alert.alert onto window.alert / window.confirm.
 *
 * Native builds are untouched: installWebAlert() does nothing unless Platform.OS === 'web'.
 */
type BrowserDialogs = {
  alert?: (text: string) => void;
  confirm?: (text: string) => boolean;
};

export function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const dialogs = globalThis as unknown as BrowserDialogs;
  const text = message ? `${title}\n\n${message}` : title;

  // One (or no) button: informational, just show it and report the press.
  if (!buttons || buttons.length <= 1) {
    dialogs.alert?.(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  // Several buttons: OK/Cancel. OK triggers the affirmative button (the last one that is not
  // 'cancel'), Cancel triggers the 'cancel' button.
  const cancel = buttons.find((b) => b.style === 'cancel');
  const confirmButton = [...buttons].reverse().find((b) => b.style !== 'cancel') ?? buttons[buttons.length - 1];
  const accepted = dialogs.confirm ? dialogs.confirm(text) : true;
  (accepted ? confirmButton : cancel)?.onPress?.();
}

export function installWebAlert(): void {
  if (Platform.OS === 'web') {
    Alert.alert = webAlert;
  }
}
