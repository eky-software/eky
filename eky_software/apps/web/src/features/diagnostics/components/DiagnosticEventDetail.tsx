import type { DiagnosticEventItem } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';
import styles from './DiagnosticEventDetail.module.css';

interface DiagnosticEventDetailProps {
  event: DiagnosticEventItem;
}

export function DiagnosticEventDetail({
  event,
}: DiagnosticEventDetailProps): React.JSX.Element {
  const details = [
    detail(uiText.diagnostics.category, event.category),
    detail(uiText.diagnostics.appVersion, event.appVersion),
    detail(uiText.diagnostics.buildRevision, event.buildRevision),
    detail(uiText.diagnostics.correlationId, event.correlationId),
    detail(
      uiText.diagnostics.duration,
      event.durationMs === undefined
        ? undefined
        : uiText.diagnostics.durationValue(event.durationMs),
    ),
    detail(uiText.diagnostics.operationId, event.operationId),
    detail(uiText.diagnostics.stage, event.stage),
    detail(
      uiText.diagnostics.sideEffectState,
      event.sideEffectState === undefined
        ? undefined
        : uiText.diagnostics.sideEffectStates[event.sideEffectState],
    ),
    detail(
      uiText.diagnostics.retryable,
      event.retryable === undefined
        ? undefined
        : event.retryable
          ? uiText.diagnostics.yes
          : uiText.diagnostics.no,
    ),
    detail(uiText.diagnostics.fingerprint, event.fingerprint),
    detail(uiText.diagnostics.runtimeInstance, event.runtimeInstanceId),
  ].filter(isPresent);

  return (
    <details className={styles.details}>
      <summary>{uiText.diagnostics.showDetails}</summary>
      <dl className={styles.list}>
        {details.map(({ label, value }) => (
          <div className={styles.item} key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

interface Detail {
  label: string;
  value: string | undefined;
}

interface PresentDetail {
  label: string;
  value: string;
}

function detail(label: string, value: string | undefined): Detail {
  return { label, value };
}

function isPresent(value: Detail): value is PresentDetail {
  return value.value !== undefined;
}
