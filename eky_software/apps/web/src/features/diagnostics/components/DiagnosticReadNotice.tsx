import type { DiagnosticReadState } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';

export function DiagnosticReadNotice({ readState, summary = false, className }: {
  readState: DiagnosticReadState;
  summary?: boolean;
  className?: string;
}): React.JSX.Element | null {
  if (readState.status === 'complete') return null;
  const text = summary ? uiText.diagnostics.summaryRead : uiText.diagnostics.eventRead;
  if (readState.status === 'unavailable') {
    const notConfigured = readState.reasons[0] === 'notConfigured';
    return <p className={className} role={notConfigured ? 'status' : 'alert'}>{notConfigured ? text.notConfigured : text.unavailable}</p>;
  }
  return <p className={className} role="status">{text.partial}</p>;
}
