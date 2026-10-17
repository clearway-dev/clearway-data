// Web shim: expo-secure-store nema webovou implementaci (ExpoSecureStore.web.js exportuje {}),
// takze SecureStore.setItemAsync na webu hodi vyjimku a prihlaseni spadne az PO uspesnem loginu.
// Tady ji nahrazujeme localStorage. Pouziva se jen pri `expo start --web`, nativni build se nemeni.
const memory = new Map();

function store() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {
    // localStorage muze byt zablokovany (private mode) -> fallback do pameti
  }
  return null;
}

export async function getItemAsync(key) {
  const s = store();
  if (s) return s.getItem(key);
  return memory.has(key) ? memory.get(key) : null;
}

export async function setItemAsync(key, value) {
  const s = store();
  if (s) s.setItem(key, value);
  else memory.set(key, value);
}

export async function deleteItemAsync(key) {
  const s = store();
  if (s) s.removeItem(key);
  else memory.delete(key);
}

export async function isAvailableAsync() {
  return true;
}

export function canUseBiometricAuthentication() {
  return false;
}

export const WHEN_UNLOCKED = 'whenUnlocked';
export const AFTER_FIRST_UNLOCK = 'afterFirstUnlock';
export const ALWAYS = 'always';

export default { getItemAsync, setItemAsync, deleteItemAsync, isAvailableAsync };
