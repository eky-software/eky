import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { CreateSupportBundle } from '../../app/desktopBridge.js';

export interface WorkspaceSupportBundleController {
  readonly state: 'idle' | 'pending' | 'created' | 'failed';
  readonly disabled: boolean;
  create(): void;
}

export function useWorkspaceSupportBundle(
  createSupportBundle: CreateSupportBundle | undefined,
  disabled: boolean,
): WorkspaceSupportBundleController {
  const owner = useMemo(() => ({ active: false, epoch: 0, pending: false }), [createSupportBundle]);
  const currentOwner = useRef<typeof owner | null>(null);
  const disabledNow = useRef(disabled);
  const [view, setView] = useState({ owner, state: 'idle' as WorkspaceSupportBundleController['state'] });
  const state = view.owner === owner ? view.state : 'idle';

  useLayoutEffect(() => {
    disabledNow.current = disabled;
  }, [disabled]);

  useLayoutEffect(() => {
    currentOwner.current = owner;
    owner.active = true;
    owner.pending = false;
    setView({ owner, state: 'idle' });
    return () => {
      owner.active = false;
      owner.epoch += 1;
      if (currentOwner.current === owner) currentOwner.current = null;
    };
  }, [owner]);

  async function create(): Promise<void> {
    if (createSupportBundle === undefined || disabled || disabledNow.current ||
        !owner.active || currentOwner.current !== owner || owner.pending) return;
    owner.pending = true;
    const epoch = owner.epoch;
    const isCurrent = () => owner.active && owner.epoch === epoch && currentOwner.current === owner;
    setView({ owner, state: 'pending' });
    try {
      const result = await createSupportBundle();
      if (isCurrent()) setView({ owner, state: result === 'created' ? 'created' : 'idle' });
    } catch {
      if (isCurrent()) setView({ owner, state: 'failed' });
    } finally {
      if (isCurrent()) owner.pending = false;
    }
  }

  return { state, disabled: createSupportBundle === undefined || disabled || state === 'pending',
    create: () => { void create(); } };
}
