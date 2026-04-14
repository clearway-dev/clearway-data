/**
 * SyncErrorsScreen — Management by Exception screen for pending/failed sync data.
 *
 * Tests verify:
 * - Loading state renders ActivityIndicator
 * - Empty state (no unsent, no errors) shows the green checkmark
 * - Unsent sessions are listed with their count and "Odeslat nyní" button
 * - Error sessions are listed with their error message and "Zkusit znovu" / "Smazat"
 * - "Zkusit znovu" calls retryErrorRecordsBySession + forceSync + reloads data
 * - "Smazat" shows a confirmation Alert; confirming calls deleteErrorRecordsBySession
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SyncErrorsScreen } from '../../screens/SyncErrorsScreen';
import { DatabaseService } from '../../services/database.service';
import { SyncService } from '../../services/sync.service';

// Alert.alert is set up as jest.fn() globally in jest.setup.ts.

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../../services/database.service');
jest.mock('../../services/sync.service');

// react-navigation prop mock
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as import('@react-navigation/native-stack').NativeStackNavigationProp<
  import('../../types/navigation').RootStackParamList,
  'SyncErrors'
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const renderScreen = () =>
  render(<SyncErrorsScreen navigation={mockNavigation} />);

const noData = () => {
  (DatabaseService.getUnsentSessionGroups as jest.Mock).mockResolvedValue([]);
  (DatabaseService.getErrorSessionGroups as jest.Mock).mockResolvedValue([]);
};

const withUnsentSession = (sessionId = 'abcdef12-0000-0000-0000-000000000000') => {
  (DatabaseService.getUnsentSessionGroups as jest.Mock).mockResolvedValue([
    { session_id: sessionId, count: 42, oldest_measurement_at: '2024-01-01T10:00:00Z' },
  ]);
  (DatabaseService.getErrorSessionGroups as jest.Mock).mockResolvedValue([]);
};

const withErrorSession = (sessionId = 'eeeeeeee-0000-0000-0000-000000000000') => {
  (DatabaseService.getUnsentSessionGroups as jest.Mock).mockResolvedValue([]);
  (DatabaseService.getErrorSessionGroups as jest.Mock).mockResolvedValue([
    {
      session_id: sessionId,
      count: 5,
      error_message: 'HTTP 422: Invalid coordinates',
      first_error_at: '2024-01-02T08:00:00Z',
    },
  ]);
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (SyncService.forceSync as jest.Mock).mockResolvedValue(undefined);
  // Alert.alert is cleared by jest.setup.ts beforeEach automatically.
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe('SyncErrorsScreen — loading state', () => {
  it('renders an ActivityIndicator while data is being fetched', () => {
    (DatabaseService.getUnsentSessionGroups as jest.Mock).mockReturnValue(
      new Promise(() => {})
    );
    (DatabaseService.getErrorSessionGroups as jest.Mock).mockReturnValue(
      new Promise(() => {})
    );

    const { UNSAFE_getByType } = renderScreen();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('SyncErrorsScreen — empty state', () => {
  it('shows the success message when there are no pending or failed sessions', async () => {
    noData();

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('Vše v pořádku')).toBeTruthy();
    });
  });

  it('shows the subtitle text in the empty state', async () => {
    noData();

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(
        getByText('Všechna data jsou úspěšně odeslána na server')
      ).toBeTruthy();
    });
  });
});

// ── Unsent sessions ───────────────────────────────────────────────────────────

describe('SyncErrorsScreen — unsent sessions', () => {
  it('renders an unsent session card with truncated session id and count', async () => {
    withUnsentSession('abcdef12-0000-0000-0000-000000000000');

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/abcdef12/)).toBeTruthy();
      expect(getByText('42')).toBeTruthy();
    });
  });

  it('"Odeslat nyní" calls SyncService.forceSync and reloads data', async () => {
    (DatabaseService.getUnsentSessionGroups as jest.Mock)
      .mockResolvedValueOnce([
        { session_id: 'abcdef12-0000-0000-0000-000000000000', count: 42, oldest_measurement_at: null },
      ])
      .mockResolvedValueOnce([]);
    (DatabaseService.getErrorSessionGroups as jest.Mock).mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Odeslat nyní')).toBeTruthy());

    // The button's onPress calls e.stopPropagation() to prevent card tap;
    // pass a compatible event object so the handler doesn't throw.
    await act(async () => {
      fireEvent.press(getByText('Odeslat nyní'), { stopPropagation: jest.fn() });
    });

    expect(SyncService.forceSync).toHaveBeenCalledTimes(1);
  });
});

// ── Error sessions ────────────────────────────────────────────────────────────

describe('SyncErrorsScreen — error sessions', () => {
  it('renders an error card with the error message snippet', async () => {
    withErrorSession();

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/HTTP 422/)).toBeTruthy();
    });
  });

  it('"Zkusit znovu" resets error records and triggers forceSync', async () => {
    const sessionId = 'eeeeeeee-0000-0000-0000-000000000000';
    (DatabaseService.getUnsentSessionGroups as jest.Mock).mockResolvedValue([]);
    (DatabaseService.getErrorSessionGroups as jest.Mock)
      .mockResolvedValueOnce([
        { session_id: sessionId, count: 5, error_message: 'HTTP 422: Invalid coordinates', first_error_at: null },
      ])
      .mockResolvedValueOnce([]);
    (DatabaseService.retryErrorRecordsBySession as jest.Mock).mockResolvedValueOnce(5);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Zkusit znovu')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Zkusit znovu'), { stopPropagation: jest.fn() });
    });

    expect(DatabaseService.retryErrorRecordsBySession).toHaveBeenCalledWith(sessionId);
    expect(SyncService.forceSync).toHaveBeenCalledTimes(1);
  });

  it('"Smazat" shows a confirmation Alert before deleting', async () => {
    withErrorSession();

    const { getAllByText } = renderScreen();

    await waitFor(() => expect(getAllByText('Smazat').length).toBeGreaterThan(0));

    // stopPropagation is needed because the button is inside a tappable card
    fireEvent.press(getAllByText('Smazat')[0], { stopPropagation: jest.fn() });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Smazat chybová data',
      expect.stringContaining('eeeeeeee'),
      expect.any(Array)
    );
    expect(DatabaseService.deleteErrorRecordsBySession).not.toHaveBeenCalled();
  });

  it('calls deleteErrorRecordsBySession when user confirms deletion', async () => {
    const sessionId = 'eeeeeeee-0000-0000-0000-000000000000';
    (DatabaseService.getUnsentSessionGroups as jest.Mock).mockResolvedValue([]);
    (DatabaseService.getErrorSessionGroups as jest.Mock)
      .mockResolvedValueOnce([
        { session_id: sessionId, count: 5, error_message: null, first_error_at: null },
      ])
      .mockResolvedValueOnce([]);
    (DatabaseService.deleteErrorRecordsBySession as jest.Mock).mockResolvedValueOnce(5);

    // Auto-confirm the Alert by immediately calling the destructive button's onPress
    (Alert.alert as jest.Mock).mockImplementationOnce(
      (_title: string, _msg: string, buttons: Array<{ text: string; onPress?: () => void }>) => {
        const deleteButton = buttons.find((b) => b.text === 'Smazat');
        deleteButton?.onPress?.();
      }
    );

    const { getAllByText } = renderScreen();

    await waitFor(() => expect(getAllByText('Smazat').length).toBeGreaterThan(0));

    await act(async () => {
      fireEvent.press(getAllByText('Smazat')[0], { stopPropagation: jest.fn() });
    });

    await waitFor(() => {
      expect(DatabaseService.deleteErrorRecordsBySession).toHaveBeenCalledWith(sessionId);
    });
  });
});
