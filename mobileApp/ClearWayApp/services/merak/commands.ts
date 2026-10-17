/**
 * Command catalogue of the measuring unit and helpers that turn replies into readable results.
 *
 * Source of truth: ClearWay-FW/specifikace-zarizeni.md (section 5) and src/commands.cpp.
 * The firmware replies to every command with one 0xBB machine reply (command letter, status,
 * value) and, while text replies are on (Y1), a few text lines starting with '>'.
 * Service commands (!rmt, !tx, !rate) all answer with the letter '!'.
 */
import { MerakConfig } from '../../config/merak.config';

/** Which firmware generation the app talks to. Switched manually in the app. */
export type FwProfile = '3.6' | '4.0';

export interface FwProfileInfo {
  id: FwProfile;
  label: string;
  /** Protocol version the firmware puts in the upper nibble of byte 1 of every data frame. */
  protocol: number;
  /** The app has a parser for the data frames of this firmware. */
  frameParserReady: boolean;
  note: string;
}

export const FW_PROFILES: FwProfileInfo[] = [
  {
    id: '3.6',
    label: 'FW 3.6.0',
    protocol: 1,
    frameParserReady: true,
    note: 'Protokol 1 (FW do 3.6): rámce 25 B / 13 B, jen platný / neplatný odečet.',
  },
  {
    id: '4.0',
    label: 'FW 4.0.0',
    protocol: 2,
    frameParserReady: true,
    note: 'Protokol 2: rámce 27 B / 14 B se stavem každého senzoru (OK, příliš blízko, nic v dosahu, porucha).',
  },
];

export const profileInfo = (id: FwProfile): FwProfileInfo =>
  FW_PROFILES.find((p) => p.id === id) ?? FW_PROFILES[0];

export type CommandGroup = 'settings' | 'info' | 'service' | 'system';

export const GROUP_TITLE: Record<CommandGroup, string> = {
  settings: 'Nastavení',
  info: 'Informace',
  service: 'Servisní diagnostika',
  system: 'Systém',
};

export interface CommandArg {
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  unit: string;
}

export interface CommandDef {
  id: string;
  group: CommandGroup;
  title: string;
  description: string;
  /** Builds the ASCII text written to the MSG characteristic. */
  build: (arg?: number) => string;
  arg?: CommandArg;
  /** The device blocks for seconds, so the reply timeout is much longer. */
  longRunning?: boolean;
  expectedSeconds?: number;
  /** Shown in a confirmation dialog before the command is sent. */
  confirm?: string;
  /** Firmware accepts it over BLE only in a build without pairing (FW 3.6.0: !tx, !rate). */
  devBuildOnly?: boolean;
}

export const COMMANDS: CommandDef[] = [
  {
    id: 'mode-min',
    group: 'settings',
    title: 'Mód MIN',
    description: 'Měřák posílá jen nejkratší vzdálenost za jednotku (rámec 13 B).',
    build: () => 'A0',
  },
  {
    id: 'mode-raw',
    group: 'settings',
    title: 'Mód RAW',
    description:
      'Měřák posílá všech 8 senzorů (rámec 27 B, ve FW 3.6 25 B). Vyžaduje MTU alespoň 30 (FW 3.6: 28), jinak ho odmítne.',
    build: () => 'A1',
  },
  {
    id: 'rate',
    group: 'settings',
    title: 'Frekvence rámců',
    description: 'Kolikrát za sekundu měřák pošle datový rámec (výchozí 10 Hz).',
    build: (n) => `R${n}`,
    arg: {
      label: 'Frekvence',
      min: MerakConfig.RATE_MIN_HZ,
      max: MerakConfig.RATE_MAX_HZ,
      defaultValue: MerakConfig.DEFAULT_RATE_HZ,
      unit: 'Hz',
    },
  },
  {
    id: 'text-on',
    group: 'settings',
    title: 'Textové odpovědi zapnout',
    description: 'Měřák k strojové odpovědi přidá čitelný text (výchozí).',
    build: () => 'Y1',
  },
  {
    id: 'text-off',
    group: 'settings',
    title: 'Textové odpovědi vypnout',
    description: 'Šetří datový tok. Servisní výpisy (!rmt, !tx, Q) pak nebudou mít text.',
    build: () => 'Y0',
  },
  {
    id: 'wifi-on',
    group: 'settings',
    title: 'Wi-Fi + OTA zapnout',
    description: 'Zapne Wi-Fi a OTA stránku na 10 minut (jen master, od FW 3.5.0).',
    build: () => 'W1',
  },
  {
    id: 'wifi-off',
    group: 'settings',
    title: 'Wi-Fi + OTA vypnout',
    description: 'Vypne Wi-Fi a OTA stránku.',
    build: () => 'W0',
  },
  {
    id: 'version',
    group: 'info',
    title: 'Verze (V)',
    description: 'Verze firmware, role, verze protokolu, sériové číslo a příznak vývojového buildu.',
    build: () => 'V',
  },
  {
    id: 'info',
    group: 'info',
    title: 'Stav senzorů (I)',
    description: 'Bitmapa platnosti senzorů: master J1-J4 a slave S1-S4.',
    build: () => 'I',
  },
  {
    id: 'stats',
    group: 'info',
    title: 'Statistika (Q)',
    description: 'Počty platných a zahozených odečtů, spoj ke slave, verze a restarty slave.',
    build: () => 'Q',
  },
  {
    id: 'rmt',
    group: 'service',
    title: 'Vzorkování senzorů (!rmt)',
    description:
      'Změří, kolik snímků za sekundu dá každý senzor (RMT) souběžně s běžným provozem. Nic nemění.',
    build: () => '!rmt',
    longRunning: true,
    expectedSeconds: 5,
  },
  {
    id: 'tx',
    group: 'service',
    title: 'Hledání vodiče TX (!tx)',
    description: 'Najde vodič ESP TX → vstup senzoru (dotaz na verzi FW senzoru). Ve FW 4.0 měření běží dál.',
    build: () => '!tx',
    longRunning: true,
    expectedSeconds: 15,
    devBuildOnly: true,
    confirm: 'Příkaz vysílá do senzorů. Ve FW 3.6 se měření na několik sekund pozastaví. Pokračovat?',
  },
  {
    id: 'sensor-rate',
    group: 'service',
    title: 'Frekvence senzorů (!rate)',
    description: 'Nastaví vzorkovací frekvenci samotných lidarů. Změna se TRVALE uloží do senzorů.',
    build: (n) => `!rate${n}`,
    arg: {
      label: 'Frekvence senzorů',
      min: MerakConfig.SENSOR_RATE_MIN_HZ,
      max: MerakConfig.SENSOR_RATE_MAX_HZ,
      defaultValue: 250,
      unit: 'Hz',
    },
    longRunning: true,
    expectedSeconds: 3,
    devBuildOnly: true,
    confirm: 'Frekvence se trvale uloží do senzorů (přežije vypnutí). Zpět ji lze vrátit stejným příkazem. Pokračovat?',
  },
  {
    id: 'restart',
    group: 'system',
    title: 'Restart měřáku (Z)',
    description: 'Softwarový restart zařízení. Spojení se přeruší a je nutné se znovu připojit.',
    build: () => 'Z',
    confirm: 'Měřák se restartuje a spojení se přeruší. Pokračovat?',
  },
];

export const commandById = (id: string): CommandDef | undefined => COMMANDS.find((c) => c.id === id);

export const commandsByGroup = (group: CommandGroup): CommandDef[] => COMMANDS.filter((c) => c.group === group);

/** Does the command exist for the selected firmware profile? 4.0.0 keeps the same set for now. */
export const commandsForProfile = (_profile: FwProfile): CommandDef[] => COMMANDS;

/**
 * Build and validate the ASCII command. Throws RangeError for a bad argument, so the UI can show
 * the message instead of sending something the firmware would answer with status 1.
 */
export function buildCommand(def: CommandDef, arg?: number): string {
  if (def.arg) {
    if (arg === undefined || !Number.isInteger(arg)) {
      throw new RangeError(`${def.arg.label}: zadejte celé číslo`);
    }
    if (arg < def.arg.min || arg > def.arg.max) {
      throw new RangeError(`${def.arg.label}: ${def.arg.min} až ${def.arg.max} ${def.arg.unit}`);
    }
  }
  const text = def.build(arg);
  if (text.length > MerakConfig.MAX_COMMAND_LENGTH) {
    throw new RangeError(`Příkaz je delší než ${MerakConfig.MAX_COMMAND_LENGTH} znaků`);
  }
  return text;
}

/** Short human readable meaning of the 16-bit value in a machine reply. */
export function describeReplyValue(command: string, value: number): string | null {
  switch (command) {
    case 'M':
      return value === 1 ? 'měření běží' : 'měření zastaveno';
    case 'A':
      return value === 1 ? 'mód RAW' : value === 2 ? 'mód MIN' : null;
    case 'R':
      return `${value} Hz`;
    case 'Y':
      return value ? 'textové odpovědi zapnuty' : 'textové odpovědi vypnuty';
    case 'W':
      return value > 0 ? `Wi-Fi zapnutá, zbývá ${value} min` : 'Wi-Fi vypnutá';
    case 'V':
      return `protokol ${value}`;
    case 'I': {
      const bits = (from: number) =>
        [0, 1, 2, 3].map((i) => (((value >> (from + i)) & 1) === 1 ? '1' : '0')).join('');
      return `master ${bits(0)}, slave ${bits(4)}`;
    }
    case 'Q':
      return `${value} timeoutů slave`;
    case 'Z':
      return 'restart';
    default:
      return null;
  }
}

export interface DeviceInfo {
  firmware: string;
  role: string;
  protocol: number;
  serial: string;
  /** Build without BLE encryption; !tx and !rate are then allowed over BLE. */
  devBuild: boolean;
}

/** Parse the text reply of V: ">FW 3.6.0 role MASTER protocol 1 SN 3485... DEV BUILD (no encryption)". */
export function parseVersionText(text: string): DeviceInfo | null {
  const m = /FW\s+(\S+)\s+role\s+(\S+)\s+protocol\s+(\d+)\s+SN\s+(\S+)/.exec(text);
  if (!m) return null;
  return {
    firmware: m[1],
    role: m[2],
    protocol: Number(m[3]),
    serial: m[4],
    devBuild: /DEV BUILD/.test(text),
  };
}

/** The profile that matches the reported firmware, for the mismatch warning. */
export const profileForFirmware = (firmware: string): FwProfile => (firmware.startsWith('4.') ? '4.0' : '3.6');

export interface ResultRow {
  label: string;
  value: string;
  /** false = highlight as a problem, undefined = neutral. */
  ok?: boolean;
}

/** Turn the multi-line text of a service command into table rows; empty when nothing matches. */
export function parseServiceText(commandId: string, text: string): ResultRow[] {
  const rows: ResultRow[] = [];
  const lines = text.split('\n').map((l) => l.trim());

  if (commandId === 'rmt') {
    for (const line of lines) {
      const head = /^RMT\s+(\d+)\s*s,\s*decode CPU\s+([\d.]+)\s*%/.exec(line);
      if (head) {
        rows.push({ label: 'Délka testu', value: `${head[1]} s` });
        rows.push({ label: 'CPU dekódování', value: `${head[2]} %` });
        continue;
      }
      const s = /^(.+?)\s+GPIO(\d+):\s*(\d+)\s*fr\/s\s+err\s+(\d+)\s+ovf\s+(\d+)/.exec(line);
      if (s) {
        const clean = s[4] === '0' && s[5] === '0';
        rows.push({
          label: `${s[1]} (GPIO${s[2]})`,
          value: `${s[3]} snímků/s, chyb ${s[4]}, přetečení ${s[5]}`,
          ok: clean && Number(s[3]) > 0,
        });
      }
    }
  } else if (commandId === 'tx') {
    for (const line of lines) {
      const found = /^(.+?)\s+RX GPIO(\d+):\s*TX GPIO(\d+),\s*sensor FW\s+(\S+)/.exec(line);
      if (found) {
        rows.push({ label: `${found[1]} (RX GPIO${found[2]})`, value: `TX GPIO${found[3]}, FW senzoru ${found[4]}`, ok: true });
        continue;
      }
      const missing = /^(.+?)\s+RX GPIO(\d+):\s*TX not found/.exec(line);
      if (missing) rows.push({ label: `${missing[1]} (RX GPIO${missing[2]})`, value: 'TX nenalezen', ok: false });
    }
  } else if (commandId === 'sensor-rate') {
    for (const line of lines) {
      const head = /^Rate\s+(\d+)\s*Hz/.exec(line);
      if (head) {
        rows.push({ label: 'Požadovaná frekvence', value: `${head[1]} Hz` });
        continue;
      }
      const s = /^(.+?):\s*set\s+(\S+(?: \S+)?),\s*save\s+(.+)$/.exec(line);
      if (s) {
        rows.push({ label: s[1], value: `nastavení ${s[2]}, uložení ${s[3]}`, ok: s[2] === 'OK' && s[3] === 'OK' });
      } else if (/No sensor with (known TX|TX wire)/.test(line)) {
        rows.push({ label: 'Chyba', value: 'Žádný senzor nemá známý TX, nejdřív spusťte !tx', ok: false });
      }
    }
  }
  return rows;
}
