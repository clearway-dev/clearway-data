import { useEffect, useState } from 'react';
import { useBle } from '../contexts/BleContext';
import type { StoreSnapshot } from '../services/merak/merak.store';

export interface MerakSnapshotState {
  snap: StoreSnapshot;
  /** Clock of the last refresh, so components can show "x ms ago" without their own timers. */
  now: number;
}

/**
 * Low-rate view of the live data of the measuring unit. The unit sends 10-100 frames per second,
 * so components poll the store a few times per second instead of re-rendering per frame.
 */
export function useMerakSnapshot(intervalMs = 250): MerakSnapshotState {
  const { store } = useBle();
  const [state, setState] = useState<MerakSnapshotState>(() => ({
    snap: store.getSnapshot(),
    now: Date.now(),
  }));

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setState({ snap: store.getSnapshot(now), now });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [store, intervalMs]);

  return state;
}
