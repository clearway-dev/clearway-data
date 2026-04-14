/**
 * ApiError — pure value class, no mocking required.
 *
 * Exists to verify the poison-pill detection logic that drives the entire
 * "4xx → stop retrying / 5xx → retry later" branching in SyncService.
 * A regression here silently breaks offline sync without any visible error.
 */

import { ApiError } from '../../services/api.service';

describe('ApiError', () => {
  describe('message format', () => {
    it('includes status code and detail when detail is provided', () => {
      const err = new ApiError(422, 'Unprocessable Entity', 'Field too long');
      expect(err.message).toBe('HTTP 422: Field too long');
    });

    it('falls back to statusText when detail is undefined', () => {
      const err = new ApiError(500, 'Internal Server Error');
      expect(err.message).toBe('HTTP 500: Internal Server Error');
    });

    it('exposes statusCode and statusText as own properties', () => {
      const err = new ApiError(404, 'Not Found', 'Session not found');
      expect(err.statusCode).toBe(404);
      expect(err.statusText).toBe('Not Found');
      expect(err.detail).toBe('Session not found');
    });

    it('is an instance of Error', () => {
      const err = new ApiError(400, 'Bad Request');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ApiError');
    });
  });

  describe('isClientError()', () => {
    it.each([400, 401, 403, 404, 409, 422, 429])(
      'returns true for status %i',
      (status) => {
        expect(new ApiError(status, 'x').isClientError()).toBe(true);
      }
    );

    it.each([200, 201, 301, 302, 500, 503])(
      'returns false for status %i',
      (status) => {
        expect(new ApiError(status, 'x').isClientError()).toBe(false);
      }
    );
  });

  describe('isServerError()', () => {
    it.each([500, 502, 503, 504])(
      'returns true for status %i',
      (status) => {
        expect(new ApiError(status, 'x').isServerError()).toBe(true);
      }
    );

    it.each([200, 400, 404, 422])(
      'returns false for status %i',
      (status) => {
        expect(new ApiError(status, 'x').isServerError()).toBe(false);
      }
    );
  });

  describe('isPoisonPill()', () => {
    it('returns true for any 4xx status (client error = bad data)', () => {
      expect(new ApiError(400, 'Bad Request').isPoisonPill()).toBe(true);
      expect(new ApiError(422, 'Unprocessable').isPoisonPill()).toBe(true);
    });

    it('returns false for 5xx status (server error = transient, should retry)', () => {
      expect(new ApiError(500, 'Server Error').isPoisonPill()).toBe(false);
      expect(new ApiError(503, 'Unavailable').isPoisonPill()).toBe(false);
    });

    it('returns false for 2xx status', () => {
      expect(new ApiError(200, 'OK').isPoisonPill()).toBe(false);
    });
  });
});
