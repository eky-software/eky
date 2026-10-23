import { useEffect, useState } from 'react';

import { uiText } from '../i18n/fi.js';
import { getDesktopOperationalLogFailure } from './desktopBridge.js';

export function DesktopOperationalLogNotice(): React.JSX.Element | null {
  const [failureObserved, setFailureObserved] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    let unsubscribe: (() => void) | undefined;
    const observeFailure = () => {
      if (isCurrent) {
        setFailureObserved(true);
      }
    };

    try {
      const capability = getDesktopOperationalLogFailure();
      if (capability !== undefined) {
        // Subscribe first so a failure during the initial read cannot be lost.
        try {
          unsubscribe = capability.subscribe(observeFailure);
        } catch {
          // The initial read can still report a failure without a subscription.
        }

        void capability.getStatus().then((status) => {
          if (status.failureObserved) {
            observeFailure();
          }
        }).catch(() => undefined);
      }
    } catch {
      // A broken bridge must not interrupt the business UI or log recursively.
    }

    return () => {
      isCurrent = false;
      try {
        unsubscribe?.();
      } catch {
        // Notice cleanup must not interrupt the rest of the app.
      }
    };
  }, []);

  if (!failureObserved) {
    return null;
  }

  return (
    <p className="message error-message" role="status">
      {uiText.layout.operationalLogFailure}
    </p>
  );
}
