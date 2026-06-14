import { useReducer } from 'react';

import { InvoiceDraftList } from './components/InvoiceDraftList.js';
import { NewInvoiceForm } from './components/NewInvoiceForm.js';
import {
  reduceInvoicingPageMode,
  type InvoicingPageMode,
} from './invoicingPageState.js';
import {
  useInvoiceDrafts,
  type InvoiceDraftListState,
} from './useInvoiceDrafts.js';
import { uiText } from '../../i18n/fi.js';

export function InvoicingPage(): React.JSX.Element {
  const draftState = useInvoiceDrafts();
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  return (
    <InvoicingPageView
      {...draftState}
      activeView={activeView}
      onBackToDrafts={() => dispatch({ type: 'showDraftList' })}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}

interface InvoicingPageViewProps extends InvoiceDraftListState {
  activeView: InvoicingPageMode;
  onBackToDrafts(): void;
  onNewInvoice(): void;
}

export function InvoicingPageView({
  activeView,
  drafts,
  errorMessage,
  isLoading,
  onBackToDrafts,
  onNewInvoice,
}: InvoicingPageViewProps): React.JSX.Element {
  return (
    <div className="invoicing-workspace">
      <section className="page-intro invoicing-page-header">
        <div>
          <p className="eyebrow">{uiText.invoicing.workspace}</p>
          <h2>{uiText.invoicing.title}</h2>
          <p>{uiText.invoicing.description}</p>
        </div>
      </section>

      {activeView === 'draftList' ? (
        <section className="panel invoice-draft-list-panel">
          <header className="panel-header invoice-draft-list-header">
            <div>
              <p className="panel-kicker">{uiText.invoicing.drafts}</p>
              <h2>{uiText.invoicing.draftList}</h2>
            </div>
            <div className="panel-actions">
              {!isLoading && errorMessage === null ? (
                <span
                  className="count-badge"
                  aria-label={uiText.invoicing.draftCount}
                >
                  {drafts.length}
                </span>
              ) : null}
              <button
                className="primary-action"
                onClick={onNewInvoice}
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
      ) : (
        <NewInvoiceForm onBack={onBackToDrafts} />
      )}
    </div>
  );
}
