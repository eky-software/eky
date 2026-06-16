import { useReducer } from 'react';

import { InvoiceDraftList } from './InvoiceDraftList.js';
import { NewInvoiceForm } from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import {
  reduceInvoicingPageMode,
  type InvoicingPageMode,
} from '../state/invoicingPageState.js';
import {
  useInvoiceDrafts,
  type InvoiceDraftListState,
} from '../hooks/useInvoiceDrafts.js';
import {
  useInvoiceCustomers,
  type InvoiceCustomerListState,
} from '../hooks/useInvoiceCustomers.js';
import {
  useInvoiceDraftEditor,
  type InvoiceDraftEditorState,
} from '../hooks/useInvoiceDraftEditor.js';
import { uiText } from '../../../i18n/fi.js';

export function InvoicingPage(): React.JSX.Element {
  const draftState = useInvoiceDrafts();
  const customerListState = useInvoiceCustomers();
  const draftEditorState = useInvoiceDraftEditor();
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  function handleBackToDrafts(): void {
    draftEditorState.clearDraft();
    dispatch({ type: 'showDraftList' });
  }

  function handleOpenDraft(id: string): void {
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(id);
  }

  return (
    <InvoicingPageView
      {...draftState}
      activeView={activeView}
      customerListState={customerListState}
      draftEditorState={draftEditorState}
      onBackToDrafts={handleBackToDrafts}
      onOpenDraft={handleOpenDraft}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}

interface InvoicingPageViewProps extends InvoiceDraftListState {
  activeView: InvoicingPageMode;
  customerListState: InvoiceCustomerListState;
  draftEditorState: InvoiceDraftEditorState;
  onBackToDrafts(): void;
  onOpenDraft(id: string): void;
  onNewInvoice(): void;
}

export function InvoicingPageView({
  activeView,
  customerListState,
  draftEditorState,
  drafts,
  errorMessage,
  isLoading,
  onBackToDrafts,
  onOpenDraft,
  onNewInvoice,
}: InvoicingPageViewProps): React.JSX.Element {
  return (
    <div className={styles.workspace}>
      <section className={`page-intro ${styles.pageHeader}`}>
        <div>
          <p className="eyebrow">{uiText.invoicing.workspace}</p>
          <h2>{uiText.invoicing.title}</h2>
          <p>{uiText.invoicing.description}</p>
        </div>
      </section>

      {activeView === 'draftList' ? (
        <section className={`panel ${styles.draftListPanel}`}>
          <header className={`panel-header ${styles.draftListHeader}`}>
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
            customers={customerListState.customers}
            customerErrorMessage={customerListState.errorMessage}
            drafts={drafts}
            errorMessage={errorMessage}
            isCustomerLoading={customerListState.isLoading}
            isLoading={isLoading}
            onOpenDraft={onOpenDraft}
          />
        </section>
      ) : activeView === 'newInvoice' ? (
        <NewInvoiceForm
          customerListState={customerListState}
          mode={{ type: 'create' }}
          onBack={onBackToDrafts}
        />
      ) : (
        <InvoiceDraftEditView
          customerListState={customerListState}
          draftEditorState={draftEditorState}
          onBack={onBackToDrafts}
        />
      )}
    </div>
  );
}

interface InvoiceDraftEditViewProps {
  customerListState: InvoiceCustomerListState;
  draftEditorState: InvoiceDraftEditorState;
  onBack(): void;
}

function InvoiceDraftEditView({
  customerListState,
  draftEditorState,
  onBack,
}: InvoiceDraftEditViewProps): React.JSX.Element {
  if (draftEditorState.isLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.openingDraft}
        </p>
      </section>
    );
  }

  if (draftEditorState.errorMessage !== null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className="message error-message" role="alert">
          {draftEditorState.errorMessage}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (draftEditorState.draft === null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.openDraftPrompt}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  return (
    <NewInvoiceForm
      key={draftEditorState.draft.id}
      customerListState={customerListState}
      mode={{
        draft: draftEditorState.draft,
        type: 'edit',
      }}
      onBack={onBack}
    />
  );
}
