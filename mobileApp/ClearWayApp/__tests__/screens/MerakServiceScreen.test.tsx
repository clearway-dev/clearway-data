/**
 * Service screen - every firmware command, with range checks and confirmations.
 *
 * Tests verify:
 * - all commands of the FW 3.6.0 service interface are listed
 * - buttons are disabled without a connection
 * - an out-of-range value is refused in the app and never sent
 * - risky commands (!rate permanently rewrites the sensors, Z restarts) ask first
 * - the readable result of a service command, and a failed status
 * - the live monitor shows every value of a frame
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { MerakServiceScreen } from '../../screens/MerakServiceScreen';
import { useBle } from '../../contexts/BleContext';
import { confirmAsync } from '../../components/ui/confirm';
import { ST, heartbeat, makeBle, minFrame, minFrameV2, rawFrame, rawFrameV2 } from '../helpers/merak';
import { commandById } from '../../services/merak/commands';

jest.mock('../../contexts/BleContext', () => ({ useBle: jest.fn() }));
jest.mock('../../components/ui/confirm', () => ({ confirmAsync: jest.fn() }));

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'MerakService'
>;

const result = (over: Record<string, unknown> = {}) => ({
  command: 'R',
  sent: 'R20',
  status: 0,
  statusLabel: 'OK',
  value: 20,
  message: '',
  durationMs: 120,
  ok: true,
  ...over,
});

const connected = (over = {}) =>
  makeBle({ status: 'connected', deviceName: 'ESP32bt_MeasLength', linkOk: true, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  (confirmAsync as jest.Mock).mockResolvedValue(true);
});

describe('layout', () => {
  it('lists every command of the firmware', () => {
    (useBle as jest.Mock).mockReturnValue(connected());
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    for (const id of ['mode-min', 'mode-raw', 'rate', 'text-on', 'text-off', 'wifi-on', 'wifi-off', 'version', 'info', 'stats', 'rmt', 'tx', 'sensor-rate', 'restart']) {
      expect(getByTestId(`command-${id}`)).toBeTruthy();
    }
  });

  it('disables every command without a connection', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle());
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    expect(getByTestId('run-version').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('run-rmt').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('toggleMeasureButton').props.accessibilityState?.disabled).toBe(true);
  });

  it('shows firmware, protocol, serial number and the build type of the connected unit', () => {
    (useBle as jest.Mock).mockReturnValue(
      connected({
        mtu: 247,
        deviceInfo: { firmware: '3.6.0', role: 'MASTER', protocol: 1, serial: '3485184546E5', devBuild: true },
      })
    );
    const { getByText } = render(<MerakServiceScreen navigation={navigation} />);
    expect(getByText(/Firmware 3.6.0 · MASTER · protokol 1/)).toBeTruthy();
    expect(getByText('Sériové číslo 3485184546E5')).toBeTruthy();
    expect(getByText(/Vývojový build bez šifrování/)).toBeTruthy();
  });

  it('warns that a production build refuses !tx and !rate over BLE', () => {
    (useBle as jest.Mock).mockReturnValue(
      connected({ deviceInfo: { firmware: '3.6.0', role: 'MASTER', protocol: 1, serial: 'AA', devBuild: false } })
    );
    const { getByText } = render(<MerakServiceScreen navigation={navigation} />);
    expect(getByText(/Produkční build: !tx a !rate přes BLE měřák odmítne/)).toBeTruthy();
  });

  it('goes back', () => {
    (useBle as jest.Mock).mockReturnValue(connected());
    const { getByText } = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.press(getByText('← Zpět'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('running commands', () => {
  it('sends a simple command and shows the readable result', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockResolvedValue(result({ command: 'I', sent: 'I', value: 0xf7 }));
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-info'));
    await waitFor(() => expect(getByTestId('result-info')).toBeTruthy());
    expect(ble.runCommand).toHaveBeenCalledWith(commandById('info'), undefined);
    expect(getByText('master 1110, slave 1111')).toBeTruthy();
  });

  it('sends the entered rate', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockResolvedValue(result());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.changeText(getByTestId('arg-rate'), '20');
    fireEvent.press(getByTestId('run-rate'));
    await waitFor(() => expect(ble.runCommand).toHaveBeenCalledWith(commandById('rate'), 20));
  });

  it('refuses an out-of-range rate in the app and does not send it', async () => {
    const ble = connected();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.changeText(getByTestId('arg-rate'), '500');
    fireEvent.press(getByTestId('run-rate'));
    await waitFor(() => expect(getByText('Frekvence: 1 až 100 Hz')).toBeTruthy());
    expect(ble.runCommand).not.toHaveBeenCalled();
  });

  it('refuses an empty value', async () => {
    const ble = connected();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.changeText(getByTestId('arg-sensor-rate'), '');
    fireEvent.press(getByTestId('run-sensor-rate'));
    await waitFor(() => expect(getByText(/Frekvence senzorů: /)).toBeTruthy());
    expect(ble.runCommand).not.toHaveBeenCalled();
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('asks before permanently changing the sensor rate, and sends after confirmation', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockResolvedValue(
      result({ command: '!', sent: '!rate250', value: 3, message: 'Rate 250 Hz\nJ1: set OK, save OK' })
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-sensor-rate'));
    await waitFor(() => expect(ble.runCommand).toHaveBeenCalledWith(commandById('sensor-rate'), 250));
    expect(confirmAsync).toHaveBeenCalledTimes(1);
    expect((confirmAsync as jest.Mock).mock.calls[0][1]).toContain('trvale');
    await waitFor(() => expect(getByText('nastavení OK, uložení OK')).toBeTruthy());
  });

  it('does not send a risky command when the confirmation is declined', async () => {
    (confirmAsync as jest.Mock).mockResolvedValue(false);
    const ble = connected();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-restart'));
    await waitFor(() => expect(confirmAsync).toHaveBeenCalled());
    expect(ble.runCommand).not.toHaveBeenCalled();
  });

  it('shows the parsed !rmt table with problems highlighted', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockResolvedValue(
      result({
        command: '!',
        sent: '!rmt',
        value: 3,
        durationMs: 5200,
        message: 'RMT 5 s, decode CPU 1.30 %\nJ1 GPIO18: 99 fr/s err 0 ovf 0\nJ4 GPIO16: 99 fr/s err 4 ovf 0',
      })
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-rmt'));
    await waitFor(() => expect(getByText('J1 (GPIO18)')).toBeTruthy());
    expect(getByText('J4 (GPIO16)')).toBeTruthy();
    expect(getByText('99 snímků/s, chyb 4, přetečení 0')).toBeTruthy();
    expect(getByText(/5.2 s/)).toBeTruthy();
  });

  it('shows the reason when the unit refuses a command', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockResolvedValue(
      result({ command: '!', sent: '!tx', status: 3, statusLabel: 'nelze provést', ok: false, message: 'Service command: serial line or dev build only' })
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-tx'));
    await waitFor(() => expect(getByText(/Chyba: nelze provést/)).toBeTruthy());
    expect(getByText('Service command: serial line or dev build only')).toBeTruthy();
  });

  it('shows a timeout as an error instead of crashing', async () => {
    const ble = connected();
    (ble.runCommand as jest.Mock).mockRejectedValue(new Error('Měřák neodpověděl na příkaz Q do 3 s'));
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.press(getByTestId('run-stats'));
    await waitFor(() => expect(getByText('Měřák neodpověděl na příkaz Q do 3 s')).toBeTruthy());
  });

  it('blocks the other commands while a long one is running', async () => {
    const ble = connected();
    let finish: (v: unknown) => void = () => {};
    (ble.runCommand as jest.Mock).mockReturnValue(new Promise((r) => (finish = r)));
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);

    fireEvent.press(getByTestId('run-rmt'));
    await waitFor(() => expect(getByTestId('run-version').props.accessibilityState?.disabled).toBe(true));
    await act(async () => {
      finish(result({ command: '!', sent: '!rmt' }));
    });
    await waitFor(() => expect(getByTestId('run-version').props.accessibilityState?.disabled).toBeFalsy());
  });
});

describe('measurement toggle', () => {
  it('starts the measurement', async () => {
    const ble = connected();
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.press(getByTestId('toggleMeasureButton'));
    await waitFor(() => expect(ble.startMeasurement).toHaveBeenCalledTimes(1));
  });

  it('stops a running measurement', async () => {
    const ble = connected({ measuring: true });
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);
    expect(getByText('● Měření běží')).toBeTruthy();
    fireEvent.press(getByTestId('toggleMeasureButton'));
    await waitFor(() => expect(ble.stopMeasurement).toHaveBeenCalledTimes(1));
  });

  it('reports a unit that did not confirm the state', async () => {
    const ble = connected();
    (ble.startMeasurement as jest.Mock).mockResolvedValue(false);
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.press(getByTestId('toggleMeasureButton'));
    await waitFor(() => expect(getByText('Měřák nepotvrdil požadovaný stav měření.')).toBeTruthy());
  });
});

describe('live monitor (FW 4.0.0, protocol 2)', () => {
  it('shows all eight sensors with their states, the unit minima and the frame details of a RAW frame', async () => {
    const ble = connected({ mode: 'raw', measuring: true });
    ble.store.ingest(
      rawFrameV2({
        master: [0, 130, 140, 150],
        masterStates: [ST.FAULT, ST.OK, ST.OK, ST.OK],
        slave: [200, 210, 220, 230],
        timeMs: 65432,
        age: 3,
      }),
      Date.now()
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    await waitFor(() => expect(getByTestId('merakMaster-1')).toBeTruthy());
    expect(getByTestId('merakMaster-0-state').props.children).toBe('porucha'); // J1
    expect(getByText('130 cm')).toBeTruthy();
    expect(getByText('230 cm')).toBeTruthy();
    expect(getByTestId('merakMaster-unit').props.children.join('')).toBe('Jednotka: 130 cm (J2)');
    expect(getByTestId('merakSlave-unit').props.children.join('')).toBe('Jednotka: 200 cm (S1)');
    expect(getByTestId('merakFrameMode').props.children).toBe('RAW (27 B)');
    expect(getByTestId('merakFrameTime').props.children).toBe('1:05.432');
    expect(getByTestId('merakSlaveState').props.children).toBe('připojen');
    expect(getByText('30 ms')).toBeTruthy(); // slave age 3 * 10 ms
    expect(getByTestId('merakHex').props.children).toMatch(/^aa 21 /);
  });

  it('shows "too close", "nothing in range" and a fault per sensor', async () => {
    const ble = connected({ mode: 'raw', measuring: true });
    ble.store.ingest(
      rawFrameV2({
        masterStates: [ST.OK, ST.CLOSE, ST.NOTARGET, ST.FAULT],
        slaveStates: [ST.NOTARGET, ST.NOTARGET, ST.NOTARGET, ST.NOTARGET],
      }),
      Date.now()
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);

    await waitFor(() => expect(getByTestId('merakMaster-1-state')).toBeTruthy());
    expect(getByTestId('merakMaster-1-state').props.children).toBe('příliš blízko');
    expect(getByTestId('merakMaster-2-state').props.children).toBe('nic v dosahu');
    expect(getByTestId('merakMaster-3-state').props.children).toBe('porucha');
    // too close wins for the whole unit, like in the firmware
    expect(getByTestId('merakMaster-unit').props.children.join('')).toBe('Jednotka: PŘÍLIŠ BLÍZKO (J2)');
    expect(getByTestId('merakSlave-unit').props.children.join('')).toBe('Jednotka: nic v dosahu');
    expect(getByTestId('merakTooClose')).toBeTruthy();
  });

  it('shows the two unit results of a MIN frame and a disconnected slave', async () => {
    const ble = connected();
    ble.store.ingest(
      minFrameV2({
        master: [300, 200, 250, 118],
        slaveStates: [ST.FAULT, ST.FAULT, ST.FAULT, ST.FAULT],
        slaveConnected: false,
        age: 0xff,
      }),
      Date.now()
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, getByText } = render(<MerakServiceScreen navigation={navigation} />);

    await waitFor(() => expect(getByTestId('merakMaster-min')).toBeTruthy());
    expect(getByText('118 cm')).toBeTruthy();
    expect(getByTestId('merakMaster-unit').props.children.join('')).toBe('Jednotka: 118 cm (J4)');
    expect(getByTestId('merakSlave-unit').props.children.join('')).toBe('Jednotka: PORUCHA');
    expect(getByTestId('merakFrameMode').props.children).toBe('MIN (14 B)');
    expect(getByTestId('merakSlaveState').props.children).toBe('NEPŘIPOJEN');
    expect(getByText('neznámé')).toBeTruthy();
  });

  it('accepts protocol 2 frames under the default FW 4.0.0 without a mismatch warning', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(rawFrameV2(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, queryByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(getByTestId('merakMaster-0')).toBeTruthy());
    expect(queryByTestId('merakProtocolMismatch')).toBeNull();
    expect(queryByTestId('merakUnsupported')).toBeNull();
  });

  it('warns when the unit sends protocol 1 frames while FW 4.0.0 is selected', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrame(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(getByTestId('merakProtocolMismatch')).toBeTruthy());
  });

  it('still decodes protocol 1 frames when FW 3.6.0 is selected (invalid = fault)', async () => {
    const ble = connected({ mode: 'raw', measuring: true, profile: '3.6' });
    ble.store.ingest(rawFrame({ bitmap: 0b1111_1110, values: [0xffff, 130, 140, 150, 200, 210, 220, 230] }), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId, queryByTestId } = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(getByTestId('merakMaster-0-state')).toBeTruthy());
    expect(getByTestId('merakMaster-0-state').props.children).toBe('porucha');
    expect(getByTestId('merakFrameMode').props.children).toBe('RAW (25 B)');
    expect(queryByTestId('merakProtocolMismatch')).toBeNull();
  });

  it('warns about a protocol the app does not know and shows its hex', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(rawFrame({ protocol: 3 }), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByTestId } = render(<MerakServiceScreen navigation={navigation} />);

    await waitFor(() => expect(getByTestId('merakUnsupported')).toBeTruthy());
    expect(getByTestId('merakProtocolMismatch')).toBeTruthy();
    expect(getByTestId('merakHex').props.children).toMatch(/^aa 31/);
  });

  it('warns when the unit sends another mode than the one selected in the app', async () => {
    const ble = connected({ mode: 'raw', measuring: true });
    ble.store.ingest(minFrameV2(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const { getByText } = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(getByText(/Měřák posílá mód MIN, v aplikaci je zvolen RAW/)).toBeTruthy());
  });
});

describe('console at the bottom of the service screen', () => {
  /** Text of the first <Text> of every console line of one kind, newest first. */
  const lineTexts = (utils: ReturnType<typeof render>, kind: string): string[] =>
    utils.queryAllByTestId(`console-${kind}`).map((line) => {
      const first = line.findAll((n: { type: unknown }) => n.type === 'Text')[0];
      return ([] as unknown[]).concat(first.props.children).join('');
    });

  it('shows every incoming data frame decoded, like meas_client.py', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2({ master: [426, 430, 440, 450], slave: [430, 425, 418, 422], timeMs: 1234 }), Date.now());
    ble.store.ingest(
      rawFrameV2({ masterStates: [ST.OK, ST.OK, ST.FAULT, ST.OK], master: [423, 425, 0, 423], timeMs: 1334 }),
      Date.now()
    );
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);

    await waitFor(() => expect(lineTexts(utils, 'frame')).toHaveLength(2));
    const [newest, older] = lineTexts(utils, 'frame');
    expect(older).toContain('MIN  master 426 cm (J1) · slave 418 cm (S3) · t=1234 ms');
    expect(newest).toContain('RAW  master 423 cm (J1) · slave 417 cm (S3) · t=1334 ms');
    expect(newest).toContain('J1=[423] J2=425 J3=PORUCHA J4=423 | S1=424 S2=429 S3=[417] S4=425');
  });

  it('shows commands and replies in the same console', async () => {
    const ble = connected();
    ble.store.addLog('tx', 'R10');
    ble.store.addLog('reply', 'R: OK, hodnota 10');
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(lineTexts(utils, 'tx')[0]).toContain('→ R10'));
    expect(lineTexts(utils, 'reply')[0]).toContain('← R: OK, hodnota 10');
  });

  it('shows heartbeats by default, so the stream is visibly alive before a measurement', async () => {
    const ble = connected();
    ble.store.ingest(heartbeat(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-heartbeat')).toHaveLength(1));
    expect(lineTexts(utils, 'heartbeat')[0]).toContain('* heartbeat');
  });

  it('can hide the heartbeats', async () => {
    const ble = connected();
    ble.store.ingest(heartbeat(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-heartbeat')).toHaveLength(1));

    fireEvent.press(utils.getByTestId('consoleToggleHeartbeat'));
    await waitFor(() => expect(utils.queryAllByTestId('console-heartbeat')).toHaveLength(0));
  });

  it('shows new lines as they arrive (live)', async () => {
    const ble = connected({ measuring: true });
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.getByTestId('merakConsole')).toBeTruthy());
    expect(utils.queryAllByTestId('console-frame')).toHaveLength(0);

    act(() => {
      ble.store.ingest(minFrameV2({ timeMs: 100 }), Date.now());
    });
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(1));
    act(() => {
      ble.store.ingest(minFrameV2({ timeMs: 200 }), Date.now());
      ble.store.ingest(minFrameV2({ timeMs: 300 }), Date.now());
    });
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(3));
    expect(lineTexts(utils, 'frame')[0]).toContain('t=300 ms'); // newest on top
  });

  it('offers to start the measurement from the console when it is not running', async () => {
    const ble = connected();
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    expect(utils.getByTestId('consoleLiveText').props.children).toBe('○ Měření neběží, chodí jen heartbeat');

    fireEvent.press(utils.getByTestId('consoleStart'));
    await waitFor(() => expect(ble.startMeasurement).toHaveBeenCalledTimes(1));
  });

  it('shows the live state and stops the measurement from the console', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.getByTestId('consoleLiveText').props.children).toMatch(/^● ŽIVĚ · /));

    fireEvent.press(utils.getByTestId('consoleStop'));
    await waitFor(() => expect(ble.stopMeasurement).toHaveBeenCalledTimes(1));
  });

  it('reports a unit that did not start from the console', async () => {
    const ble = connected();
    (ble.startMeasurement as jest.Mock).mockRejectedValue(new Error('Příkaz M: nelze provést'));
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    fireEvent.press(utils.getByTestId('consoleStart'));
    await waitFor(() => expect(utils.getByTestId('consoleStreamError').props.children).toBe('Příkaz M: nelze provést'));
  });

  it('has no start button without a connection and says so', () => {
    (useBle as jest.Mock).mockReturnValue(makeBle());
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    expect(utils.getByTestId('consoleLiveText').props.children).toBe('○ Měřák není připojený');
    expect(utils.queryByTestId('consoleStart')).toBeNull();
  });

  it('hides the data frames when switched off, but keeps commands', async () => {
    const ble = connected({ measuring: true });
    ble.store.addLog('tx', 'M');
    ble.store.ingest(minFrameV2(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(1));

    fireEvent.press(utils.getByTestId('consoleToggleData'));
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(0));
    expect(utils.queryAllByTestId('console-tx')).toHaveLength(1);
  });

  it('adds the raw hex of every frame on request', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2(), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(1));
    expect(utils.queryAllByTestId('console-hex')).toHaveLength(0);

    fireEvent.press(utils.getByTestId('consoleToggleHex'));
    await waitFor(() => expect(utils.queryAllByTestId('console-hex')).toHaveLength(1));
    expect(([] as unknown[]).concat(utils.getAllByTestId('console-hex')[0].props.children).join('')).toContain('aa 22');
  });

  it('always shows the hex of a frame the app cannot decode', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(rawFrame({ protocol: 3 }), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-unsupported')).toHaveLength(1));
    expect(utils.queryAllByTestId('console-hex')).toHaveLength(1);
  });

  it('freezes the view while paused and catches up afterwards', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2({ timeMs: 1 }), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(1));

    fireEvent.press(utils.getByTestId('consolePause'));
    act(() => {
      ble.store.ingest(minFrameV2({ timeMs: 2 }), Date.now());
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700)); // longer than the refresh interval
    });
    expect(utils.queryAllByTestId('console-frame')).toHaveLength(1);

    fireEvent.press(utils.getByTestId('consolePause'));
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(2));
  });

  it('marks a "too close" frame in the console', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2({ masterStates: [ST.OK, ST.CLOSE, ST.OK, ST.OK] }), Date.now());
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(lineTexts(utils, 'frame')[0]).toContain('PŘÍLIŠ BLÍZKO (J2)'));
  });

  it('clears the console', async () => {
    const ble = connected({ measuring: true });
    ble.store.ingest(minFrameV2(), Date.now());
    ble.store.addLog('tx', 'M');
    (useBle as jest.Mock).mockReturnValue(ble);
    const utils = render(<MerakServiceScreen navigation={navigation} />);
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(1));
    fireEvent.press(utils.getByTestId('merakLogClear'));
    await waitFor(() => expect(utils.queryAllByTestId('console-frame')).toHaveLength(0));
    expect(utils.queryAllByTestId('console-tx')).toHaveLength(0);
  });
});
