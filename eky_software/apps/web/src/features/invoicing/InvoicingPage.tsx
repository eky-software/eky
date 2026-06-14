import type { InvoiceDraftSummary } from '@eky/api-client';

import { InvoiceDraftList } from './components/InvoiceDraftList.js';
import {
  useInvoiceDrafts,
  type InvoiceDraftListState,
} from './useInvoiceDrafts.js';
import { uiText } from '../../i18n/fi.js';

export function InvoicingPage(): React.JSX.Element {
  const draftState = useInvoiceDrafts();

  return <InvoicingPageView {...draftState} />;
}

export function InvoicingPageView({
  drafts,
  errorMessage,
  isLoading,
}: InvoiceDraftListState): React.JSX.Element {
  return (
    <div className="invoicing-workspace">
      <section className="page-intro invoicing-page-header">
        <div>
          <p className="eyebrow">{uiText.invoicing.workspace}</p>
          <h2>{uiText.invoicing.title}</h2>
          <p>{uiText.invoicing.description}</p>
        </div>
      </section>

      <section className="panel invoice-draft-list-panel">
        <header className="panel-header invoice-draft-list-header">
          <div>
            <p className="panel-kicker">{uiText.invoicing.drafts}</p>
            <h2>{uiText.invoicing.draftList}</h2>
          </div>
          <div className="panel-actions">
            {!isLoading && errorMessage === null ? (
              <span className="count-badge" aria-label={uiText.invoicing.draftCount}>
                {drafts.length}
              </span>
            ) : null}
            <button
              className="primary-action"
              disabled
              title={uiText.invoicing.newInvoiceLater}
              type="button"
            >
              {uiText.invoicing.newInvoice}
            </button>
          </div>
        </header>

        <InvoiceDraftList
          drafts={drafts}
          errorMessage={errorMessage}
          isLoading={isLoading}
        />
      </section>
    </div>
  );
}
