/**
 * Command catalogue - ranges and texts must match src/commands.cpp (FW 3.6.0).
 *
 * Key invariants:
 * - the app never sends a value the firmware would answer with status 1 (out of range)
 * - every command fits in CMD_MAX_LEN (32) characters
 * - the text output of the service commands is turned into readable rows
 */
import {
  COMMANDS,
  FW_PROFILES,
  buildCommand,
  commandById,
  commandsForProfile,
  describeReplyValue,
  parseServiceText,
  parseVersionText,
  profileForFirmware,
  profileInfo,
} from '../../services/merak/commands';

const def = (id: string) => {
  const d = commandById(id);
  if (!d) throw new Error(`missing command ${id}`);
  return d;
};

describe('catalogue', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains every command of the FW 3.6.0 service interface', () => {
    for (const id of ['mode-min', 'mode-raw', 'rate', 'text-on', 'text-off', 'wifi-on', 'wifi-off', 'version', 'info', 'stats', 'rmt', 'tx', 'sensor-rate', 'restart']) {
      expect(commandById(id)).toBeDefined();
    }
  });

  it('does not offer the serial-only commands (!pin, !bootloader)', () => {
    const texts = COMMANDS.map((c) => c.build(c.arg?.defaultValue));
    expect(texts.some((t) => t.startsWith('!pin') || t.startsWith('!boot'))).toBe(false);
  });

  it('builds the exact strings the firmware parses', () => {
    expect(buildCommand(def('mode-min'))).toBe('A0');
    expect(buildCommand(def('mode-raw'))).toBe('A1');
    expect(buildCommand(def('rate'), 25)).toBe('R25');
    expect(buildCommand(def('text-on'))).toBe('Y1');
    expect(buildCommand(def('text-off'))).toBe('Y0');
    expect(buildCommand(def('wifi-on'))).toBe('W1');
    expect(buildCommand(def('wifi-off'))).toBe('W0');
    expect(buildCommand(def('version'))).toBe('V');
    expect(buildCommand(def('info'))).toBe('I');
    expect(buildCommand(def('stats'))).toBe('Q');
    expect(buildCommand(def('rmt'))).toBe('!rmt');
    expect(buildCommand(def('tx'))).toBe('!tx');
    expect(buildCommand(def('sensor-rate'), 250)).toBe('!rate250');
    expect(buildCommand(def('restart'))).toBe('Z');
  });

  it('keeps every default command within the firmware limit of 32 characters', () => {
    for (const c of COMMANDS) {
      expect(buildCommand(c, c.arg?.defaultValue).length).toBeLessThanOrEqual(32);
    }
  });

  it('marks the long-running service commands and the ones that need confirmation', () => {
    expect(def('rmt').longRunning).toBe(true);
    expect(def('tx').longRunning).toBe(true);
    expect(def('sensor-rate').longRunning).toBe(true);
    expect(def('sensor-rate').confirm).toBeTruthy(); // permanently rewrites the sensors
    expect(def('restart').confirm).toBeTruthy();
    expect(def('tx').devBuildOnly).toBe(true);
    expect(def('sensor-rate').devBuildOnly).toBe(true);
    expect(def('rmt').devBuildOnly).toBeUndefined(); // !rmt only measures, allowed in every build
  });
});

describe('argument validation (firmware ranges)', () => {
  it('accepts the R range 1-100 and refuses everything else', () => {
    expect(buildCommand(def('rate'), 1)).toBe('R1');
    expect(buildCommand(def('rate'), 100)).toBe('R100');
    expect(() => buildCommand(def('rate'), 0)).toThrow(RangeError);
    expect(() => buildCommand(def('rate'), 101)).toThrow(RangeError);
  });

  it('accepts the !rate range 1-250 and refuses everything else', () => {
    expect(buildCommand(def('sensor-rate'), 1)).toBe('!rate1');
    expect(buildCommand(def('sensor-rate'), 250)).toBe('!rate250');
    expect(() => buildCommand(def('sensor-rate'), 0)).toThrow(RangeError);
    expect(() => buildCommand(def('sensor-rate'), 251)).toThrow(RangeError);
  });

  it('requires an integer argument', () => {
    expect(() => buildCommand(def('rate'))).toThrow(RangeError);
    expect(() => buildCommand(def('rate'), 12.5)).toThrow(RangeError);
    expect(() => buildCommand(def('rate'), NaN)).toThrow(RangeError);
  });

  it('puts the range into the error message', () => {
    expect(() => buildCommand(def('rate'), 500)).toThrow('1 až 100 Hz');
  });
});

describe('describeReplyValue', () => {
  it('explains the M toggle', () => {
    expect(describeReplyValue('M', 1)).toBe('měření běží');
    expect(describeReplyValue('M', 0)).toBe('měření zastaveno');
  });

  it('maps the mode code (1 = raw, 2 = min)', () => {
    expect(describeReplyValue('A', 1)).toBe('mód RAW');
    expect(describeReplyValue('A', 2)).toBe('mód MIN');
  });

  it('shows the validity bitmap of I per unit', () => {
    // master J1-J3 valid, J4 invalid, slave all valid -> 0xF7
    expect(describeReplyValue('I', 0xf7)).toBe('master 1110, slave 1111');
  });

  it('shows remaining Wi-Fi minutes', () => {
    expect(describeReplyValue('W', 10)).toContain('10 min');
    expect(describeReplyValue('W', 0)).toBe('Wi-Fi vypnutá');
  });

  it('has no generic meaning for the service letter', () => {
    expect(describeReplyValue('!', 99)).toBeNull();
  });
});

describe('parseVersionText', () => {
  it('reads firmware, role, protocol, serial number and the dev build flag', () => {
    expect(parseVersionText('FW 3.6.0 role MASTER protocol 1 SN 3485184546E5 DEV BUILD (no encryption)')).toEqual({
      firmware: '3.6.0',
      role: 'MASTER',
      protocol: 1,
      serial: '3485184546E5',
      devBuild: true,
    });
  });

  it('reports a production build when the DEV BUILD note is missing', () => {
    expect(parseVersionText('FW 3.6.0 role MASTER protocol 1 SN 3485184546E5')?.devBuild).toBe(false);
  });

  it('returns null for text that is not a version line', () => {
    expect(parseVersionText('Unknown command: V')).toBeNull();
    expect(parseVersionText('')).toBeNull();
  });
});

describe('firmware profiles', () => {
  it('maps 3.6 to protocol 1 and 4.0 to protocol 2', () => {
    expect(profileInfo('3.6').protocol).toBe(1);
    expect(profileInfo('4.0').protocol).toBe(2);
    expect(FW_PROFILES.map((p) => p.id)).toEqual(['3.6', '4.0']);
  });

  it('has a frame parser for both firmware generations', () => {
    expect(profileInfo('3.6').frameParserReady).toBe(true);
    expect(profileInfo('4.0').frameParserReady).toBe(true);
    expect(profileInfo('4.0').note).toContain('27 B / 14 B');
    expect(profileInfo('3.6').note).toContain('25 B / 13 B');
  });

  it('explains the new message of !rate in FW 4.0.0', () => {
    const rows = parseServiceText('sensor-rate', 'Rate 250 Hz\nNo sensor with TX wire (config or !tx)');
    expect(rows[rows.length - 1]).toMatchObject({ ok: false });
  });

  it('picks the profile from the reported firmware', () => {
    expect(profileForFirmware('3.6.0')).toBe('3.6');
    expect(profileForFirmware('4.0.0')).toBe('4.0');
  });

  it('keeps the same command set for both profiles until 4.0.0 is specified', () => {
    expect(commandsForProfile('4.0')).toEqual(commandsForProfile('3.6'));
  });
});

describe('parseServiceText', () => {
  it('turns the !rmt output into one row per sensor and flags clean sensors', () => {
    const rows = parseServiceText(
      'rmt',
      ['RMT 5 s, decode CPU 1.30 %', 'J1 GPIO18: 99 fr/s err 0 ovf 0', 'J2 GPIO40: 101 fr/s err 0 ovf 0', 'J4 GPIO16: 99 fr/s err 2 ovf 0'].join('\n')
    );
    expect(rows[0]).toEqual({ label: 'Délka testu', value: '5 s' });
    expect(rows[1]).toEqual({ label: 'CPU dekódování', value: '1.30 %' });
    expect(rows[2]).toMatchObject({ label: 'J1 (GPIO18)', ok: true });
    expect(rows[2].value).toContain('99 snímků/s');
    expect(rows[3]).toMatchObject({ label: 'J2 (GPIO40)', ok: true });
    expect(rows[4]).toMatchObject({ label: 'J4 (GPIO16)', ok: false }); // err 2
  });

  it('flags a sensor that produced no frames', () => {
    const rows = parseServiceText('rmt', 'J3 GPIO15: 0 fr/s err 0 ovf 0');
    expect(rows[0].ok).toBe(false);
  });

  it('turns the !tx output into rows, marking sensors without a found wire', () => {
    const rows = parseServiceText(
      'tx',
      ['TX scan', 'J1 RX GPIO18: TX GPIO17, sensor FW 2.1.5', 'J2 RX GPIO40: TX not found'].join('\n')
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: 'J1 (RX GPIO18)', ok: true });
    expect(rows[0].value).toContain('TX GPIO17');
    expect(rows[1]).toMatchObject({ label: 'J2 (RX GPIO40)', value: 'TX nenalezen', ok: false });
  });

  it('turns the !rate output into rows and flags a failed save', () => {
    const rows = parseServiceText(
      'sensor-rate',
      ['Rate 250 Hz', 'J1: set OK, save OK', 'J2: set NO REPLY, save NO REPLY'].join('\n')
    );
    expect(rows[0]).toEqual({ label: 'Požadovaná frekvence', value: '250 Hz' });
    expect(rows[1]).toMatchObject({ label: 'J1', ok: true });
    expect(rows[2]).toMatchObject({ label: 'J2', ok: false });
  });

  it('explains the !rate hint when no sensor has a known TX', () => {
    const rows = parseServiceText('sensor-rate', 'Rate 250 Hz\nNo sensor with known TX, run !tx first');
    expect(rows[rows.length - 1].ok).toBe(false);
    expect(rows[rows.length - 1].value).toContain('!tx');
  });

  it('returns nothing for commands without a table, so the raw text is shown', () => {
    expect(parseServiceText('stats', 'Uptime 12 s')).toEqual([]);
    expect(parseServiceText('rmt', '')).toEqual([]);
  });
});
