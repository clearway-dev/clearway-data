# ClearWay Mobile App - Setup Guide

## 📦 Instalace závislostí

```bash
cd mobileApp/ClearWayApp
npm install
```

## 🔧 Konfigurace

### Backend URL
Aktualizujte API URL v souboru `services/api.service.ts`:

```typescript
const API_BASE_URL = 'http://YOUR_IP:8000/api';
```

Zjistit IP adresu vašeho počítače:
- **Windows**: `ipconfig` → IPv4 Address
- **Mac/Linux**: `ifconfig` → inet address

**Důležité**: Nepoužívejte `localhost` nebo `127.0.0.1` - mobilní zařízení potřebuje skutečnou IP adresu!

## ▶️ Spuštění aplikace

```bash
npm start
```

Poté:
- **Android**: Stiskněte `a` nebo naskenujte QR kód v Expo Go
- **iOS**: Stiskněte `i` nebo naskenujte QR kód v Expo Go
- **Web**: Stiskněte `w`

## 🏗️ Architektura

### Služby (Services)
- **api.service.ts** - Komunikace s backendem (vehicles, sensors, sessions, batch upload)
- **database.service.ts** - SQLite lokální databáze (CRUD operace pro measurements)
- **sync.service.ts** - Background sync worker (automatické odesílání každých 10s)

### Hooky (Hooks)
- **useLocation.ts** - GPS tracking (1x za vteřinu když je recording aktivní)
- **useMeasurement.ts** - Měření logika (START/STOP, ukládání do SQLite)
- **useSync.ts** - Sync management (statistiky, manuální sync)

### Obrazovky (Screens)
- **MeasurementScreen.tsx** - Hlavní obrazovka aplikace

## 📱 Workflow aplikace

1. **Inicializace**: Aplikace načte vozidla a senzory z backendu
2. **Výběr**: Uživatel vybere vozidlo a senzor
3. **Session**: Kliknutím na "Vytvořit novou jízdu" se vytvoří session v DB
4. **START**: Zahájí se GPS tracking a simulace senzorů
5. **Měření**: Každou vteřinu se uloží měření do SQLite
6. **Sync**: Na pozadí běží worker, který každých 10s posílá max 100 měření na backend
7. **STOP**: Ukončí měření (sync pokračuje dokud není vše odesláno)

## 🗄️ Lokální databáze

SQLite tabulka `local_measurements`:
- `id` - Auto increment
- `session_id` - UUID aktuální jízdy
- `measured_at` - ISO timestamp
- `latitude`, `longitude` - GPS souřadnice
- `distance_left`, `distance_right` - Simulované vzdálenosti (cm)
- `synced` - 0 = neodesláno, 1 = odesláno

## 🔄 Offline-First Features

- ✅ Všechna měření se ukládají lokálně
- ✅ Sync worker odesílá data na pozadí
- ✅ Pokud selže sync, data zůstanou v DB a zkusí se později
- ✅ Batch upload (max 100 měření najednou)
- ✅ Automatické čištění odeslaných dat

## 🐛 Debug

Otevřete konzoli v Expo:
```bash
npm start
# Stiskněte 'j' pro otevření Dev Tools
```

Logování:
- `✓` = úspěšná operace
- `✗` = chyba
- `🔄` = sync probíhá
- `🎬` = nahrávání zahájeno
- `⏹` = nahrávání ukončeno

## 📋 Požadované oprávnění

- **Location** - Pro GPS tracking (požadováno při prvním spuštění)

## ⚠️ Známé problémy

### "Network request failed"
- ✅ Zkontrolujte že backend běží (`docker ps`)
- ✅ Zkontrolujte IP adresu v `api.service.ts`
- ✅ Ujistěte se, že mobilní zařízení je na stejné WiFi síti

### "Database not initialized"
- ✅ Restartujte aplikaci
- ✅ Smažte cache: Expo menu → Clear cache

### GPS nepřesné hodnoty
- ✅ Testujte venku (lepší GPS signál)
- ✅ Povolte vysokou přesnost v nastavení telefonu
- ✅ V emulátoru použijte simulovanou lokaci

## 📊 Test data

Pro testování můžete použít existující session:
```
Session ID: 31046070-0bbd-44e8-9126-6b113f157507
```

## 🚀 Produkční build

```bash
# Android APK
npx expo build:android

# iOS IPA
npx expo build:ios
```
