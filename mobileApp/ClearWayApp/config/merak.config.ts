/**
 * Measuring unit ("měřák") BLE configuration.
 *
 * UUIDs and timings come from ClearWay-FW/specifikace-zarizeni.md (section 4, 5)
 * and the FW 3.6.0 README. Change them only together with the firmware.
 */

export const MerakConfig = {
  SERVICE_UUID: '0dd49bc0-5132-4921-b742-c85a41ef3e96',
  /** Client -> device, WRITE */
  MSG_UUID: 'cc8b19a4-a209-441e-a64d-28ccbaabd5bd',
  /** Device -> client, NOTIFY */
  DATA_UUID: '704b59ba-d11a-4d4f-9e41-cd675f003842',
  /** Advertised name; scanning filters by service UUID, the name is only a fallback. */
  DEVICE_NAME: 'ESP32bt_MeasLength',
  NAME_PREFIX: 'ESP32bt_',

  /** Spec 4.3: request MTU >= 64 (raw frame is 25 B). The device accepts up to 247. */
  REQUEST_MTU: 247,
  SCAN_TIMEOUT_MS: 12000,
  CONNECT_TIMEOUT_MS: 15000,

  /** Spec 5: the device must answer every command within 500 ms. We allow slack for BLE jitter. */
  COMMAND_TIMEOUT_MS: 2500,
  /** !rmt (~5 s), !tx (up to ~15 s), !rate (~3 s) block the device for seconds. */
  SERVICE_COMMAND_TIMEOUT_MS: 30000,
  /** A text reply (0x3E) follows the binary reply (0xBB); wait this long for more text lines. */
  TEXT_QUIET_MS: 300,

  /** Spec 4.4: heartbeat every 1 s, the client may report a lost link after 2 s. */
  HEARTBEAT_LOST_MS: 3000,
  /** A data frame older than this is not used for a stored measurement. */
  DATA_STALE_MS: 1500,

  DEFAULT_RATE_HZ: 10,
  RATE_MIN_HZ: 1,
  RATE_MAX_HZ: 100,
  /** Sensor frame rate set by the service command !rate (FW 3.6.0). */
  SENSOR_RATE_MIN_HZ: 1,
  SENSOR_RATE_MAX_HZ: 250,
  /** Firmware limit for one command, CMD_MAX_LEN in config.h. */
  MAX_COMMAND_LENGTH: 32,

  LOG_SIZE: 200,
  /** Incoming notifications kept for the console (at 10 Hz = 40 s of frames plus heartbeats). */
  DATA_LOG_SIZE: 400,
  FPS_WINDOW: 40,
} as const;
