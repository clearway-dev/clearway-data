/**
 * ApiService — HTTP layer for measurement batch upload and resource fetching.
 *
 * Critical paths tested:
 * - sendBatch: poison-pill (4xx) vs transient (5xx) error classification
 * - 401 on any request triggers AuthService.clearToken() so the user is logged out
 * - Network/timeout failures propagate as non-ApiError so SyncService retries
 * - Auth header is always attached using the stored Bearer token
 */

import { ApiService, ApiError } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

jest.mock('../../services/auth.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

const setupToken = (token = 'bearer-tok') => {
  (AuthService.getToken as jest.Mock).mockResolvedValue(token);
};

const mockResponse = (status: number, body: unknown, ok = status < 400) =>
  Promise.resolve({
    ok,
    status,
    statusText: 'STATUS',
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);

// Response whose body cannot be parsed as JSON (triggers the catch branch)
const mockNonJsonResponse = (status: number, statusText = 'Bad Request', ok = false) =>
  Promise.resolve({
    ok,
    status,
    statusText,
    json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
  } as unknown as Response);

const makeBatch = () => ({
  session_id: 'session-abc',
  measurements: [
    {
      measured_at: '2024-01-01T00:00:00.000Z',
      latitude: 50.0,
      longitude: 14.0,
      distance_left: 300,
      distance_right: 300,
      speed: null,
      accuracy_gps: null,
    },
  ],
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (AuthService.clearToken as jest.Mock).mockResolvedValue(undefined);
});

// ── sendBatch ─────────────────────────────────────────────────────────────────

describe('ApiService.sendBatch()', () => {
  it('succeeds and attaches Bearer token header on 2xx', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(200, {}));

    await expect(ApiService.sendBatch(makeBatch())).resolves.toBeUndefined();

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer bearer-tok');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('sends to the correct batch endpoint', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(200, {}));

    await ApiService.sendBatch(makeBatch());

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/measurements/raw-data/batch');
  });

  it('throws ApiError with isPoisonPill()=true on 422', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(422, { detail: 'Validation error' }, false)
    );

    let caught: unknown;
    try { await ApiService.sendBatch(makeBatch()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).isPoisonPill()).toBe(true);
  });

  it('throws ApiError with isPoisonPill()=false on 500', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(500, { detail: 'Internal error' }, false)
    );

    let caught: unknown;
    try { await ApiService.sendBatch(makeBatch()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).isPoisonPill()).toBe(false);
  });

  it('calls AuthService.clearToken() and throws ApiError(401) on unauthorized', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(401, { detail: 'Unauthorized' }, false)
    );

    let caught: unknown;
    try { await ApiService.sendBatch(makeBatch()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).statusCode).toBe(401);
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('propagates a plain Error (not ApiError) on network failure', async () => {
    setupToken();
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

    const error = await ApiService.sendBatch(makeBatch()).catch((e) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.message).toContain('Network error');
  });

  it('throws when no authentication token is available', async () => {
    (AuthService.getToken as jest.Mock).mockResolvedValue(null);

    await expect(ApiService.sendBatch(makeBatch())).rejects.toThrow(
      'No authentication token available'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('includes all measurement fields in the request body', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(200, {}));

    const batch = makeBatch();
    await ApiService.sendBatch(batch);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.session_id).toBe('session-abc');
    expect(body.measurements).toHaveLength(1);
    expect(body.measurements[0].latitude).toBe(50.0);
  });
});

// ── getVehicles ───────────────────────────────────────────────────────────────

describe('ApiService.getVehicles()', () => {
  it('returns vehicles array on 200', async () => {
    setupToken();
    const vehicles = [{ id: 'v1', vehicle_name: 'Octavia', width: 183 }];
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(200, vehicles));

    const result = await ApiService.getVehicles();
    expect(result).toEqual(vehicles);
  });

  it('clears token and throws on 401', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(401, {}, false));

    await expect(ApiService.getVehicles()).rejects.toThrow();
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('throws a plain Error on non-401 HTTP error without clearing token', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(403, {}, false));

    await expect(ApiService.getVehicles()).rejects.toThrow('HTTP 403');
    expect(AuthService.clearToken).not.toHaveBeenCalled();
  });
});

// ── getSensors ────────────────────────────────────────────────────────────────

describe('ApiService.getSensors()', () => {
  it('returns sensors array on 200', async () => {
    setupToken();
    const sensors = [
      { id: 's1', description: 'Sensor A', is_active: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
    ];
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(200, sensors));

    const result = await ApiService.getSensors();
    expect(result).toEqual(sensors);
  });

  it('clears token and throws on 401', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(401, {}, false));

    await expect(ApiService.getSensors()).rejects.toThrow();
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('throws a plain Error on non-401 HTTP error without clearing token', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(503, {}, false));

    await expect(ApiService.getSensors()).rejects.toThrow('HTTP 503');
    expect(AuthService.clearToken).not.toHaveBeenCalled();
  });
});

// ── createSession ─────────────────────────────────────────────────────────────

describe('ApiService.createSession()', () => {
  const vehicleId = 'vehicle-uuid';
  const sensorId = 'sensor-uuid';
  const fakeSession: import('../../types').Session = { id: 'sess-1', vehicle_id: vehicleId, sensor_id: sensorId };

  it('returns session and sends vehicle_id + sensor_id in body', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(201, fakeSession));

    const result = await ApiService.createSession(vehicleId, sensorId);
    expect(result).toEqual(fakeSession);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.vehicle_id).toBe(vehicleId);
    expect(body.sensor_id).toBe(sensorId);
  });

  it('clears token and throws on 401', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(401, {}, false));

    await expect(ApiService.createSession(vehicleId, sensorId)).rejects.toThrow('Unauthorized');
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('throws with server-provided detail message on non-401 error', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(400, { detail: 'Vehicle not found' }, false)
    );

    await expect(ApiService.createSession(vehicleId, sensorId)).rejects.toThrow('Vehicle not found');
    expect(AuthService.clearToken).not.toHaveBeenCalled();
  });

  it('falls back to default message when error body has no detail', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(400, {}, false));

    await expect(ApiService.createSession(vehicleId, sensorId)).rejects.toThrow('Failed to create session');
  });
});

// ── sendBatch — additional branches ──────────────────────────────────────────

describe('ApiService.sendBatch() — additional error branches', () => {
  it('uses statusText as detail when response body is not valid JSON', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockNonJsonResponse(422, 'Unprocessable Entity'));

    let caught: unknown;
    try { await ApiService.sendBatch(makeBatch()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('Unprocessable Entity');
    expect((caught as ApiError).isPoisonPill()).toBe(true);
  });

  it('uses errorData.message when detail field is absent', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(422, { message: 'batch too large' }, false)
    );

    let caught: unknown;
    try { await ApiService.sendBatch(makeBatch()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('batch too large');
  });
});

// ── createVehicle ─────────────────────────────────────────────────────────────

describe('ApiService.createVehicle()', () => {
  const req: import('../../types').CreateVehicleRequest = { vehicle_name: 'Fabia', width: 165 };
  const fakeVehicle: import('../../types').Vehicle = { id: 'v-new', vehicle_name: 'Fabia', width: 165 };

  it('returns created vehicle on 201', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(201, fakeVehicle));

    const result = await ApiService.createVehicle(req);
    expect(result).toEqual(fakeVehicle);
  });

  it('clears token and throws on 401', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(401, {}, false));

    await expect(ApiService.createVehicle(req)).rejects.toThrow('Unauthorized');
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError with server detail on non-401 JSON error', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(400, { detail: 'Name already taken' }, false)
    );

    let caught: unknown;
    try { await ApiService.createVehicle(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('Name already taken');
  });

  it('throws ApiError with message field when detail is absent', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(422, { message: 'width must be positive' }, false)
    );

    let caught: unknown;
    try { await ApiService.createVehicle(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('width must be positive');
  });

  it('throws ApiError with statusText when body is not JSON', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockNonJsonResponse(500, 'Internal Server Error'));

    let caught: unknown;
    try { await ApiService.createVehicle(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('Internal Server Error');
  });
});

// ── createSensor ──────────────────────────────────────────────────────────────

describe('ApiService.createSensor()', () => {
  const req: import('../../types').CreateSensorRequest = { description: 'Ultrasonic v2', is_active: true };
  const fakeSensor: import('../../types').Sensor = {
    id: 's-new',
    description: 'Ultrasonic v2',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  it('returns created sensor on 201', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(201, fakeSensor));

    const result = await ApiService.createSensor(req);
    expect(result).toEqual(fakeSensor);
  });

  it('clears token and throws on 401', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockResponse(401, {}, false));

    await expect(ApiService.createSensor(req)).rejects.toThrow('Unauthorized');
    expect(AuthService.clearToken).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError with server detail on non-401 JSON error', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(400, { detail: 'Description too long' }, false)
    );

    let caught: unknown;
    try { await ApiService.createSensor(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('Description too long');
  });

  it('throws ApiError with message field when detail is absent', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(
      mockResponse(422, { message: 'description required' }, false)
    );

    let caught: unknown;
    try { await ApiService.createSensor(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('description required');
  });

  it('throws ApiError with statusText when body is not JSON', async () => {
    setupToken();
    global.fetch = jest.fn().mockReturnValueOnce(mockNonJsonResponse(503, 'Service Unavailable'));

    let caught: unknown;
    try { await ApiService.createSensor(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('Service Unavailable');
  });
});
