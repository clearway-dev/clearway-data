import { registerRootComponent } from 'expo';

import App from './App';
import { installWebAlert } from './services/web-alert';

// Alert.alert is a no-op on React Native Web; map it to window.alert / window.confirm (web only).
installWebAlert();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
