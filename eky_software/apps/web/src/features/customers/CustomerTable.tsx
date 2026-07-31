import type { Customer } from '@eky/api-client';

import {
  formatManagedHousingCompanyCount,
  getCustomerRelationshipLabel,
  getCustomerStatusLabel,
  getCustomerTypeLabel,
  getPrimaryContact,
} from './customerDisplay.js';
import type { CustomerListGroup } from './customerListGrouping.js';
import type { CustomerSortKey, CustomerSortState } from './customerListSorting.js';
import { getSortDirectionLabel } from './CustomerListToolbar.js';
import styles from './CustomerTable.module.css';
import { uiText } from '../../i18n/fi.js';

interface CustomerTableProps {
  customers: Customer[];
  customerGroups: CustomerListGroup[];
  expandedPropertyManagerIds: ReadonlySet<string>;
  sortState: CustomerSortState;
  onCustomerSelect(customer: Customer): void;
  onPropertyManagerToggle(customerId: string): void;
  onSortChange(sortKey: CustomerSortKey): void;
}

export function CustomerTable({
  customers,
  customerGroups,
  expandedPropertyManagerIds,
  sortState,
  onCustomerSelect,
  onPropertyManagerToggle,
  onSortChange,
}: CustomerTableProps): React.JSX.Element {
  return (
    <div className={styles.table} role="table" aria-label={uiText.customers.customers}>
      <div className={`${styles.row} ${styles.head}`} role="row">
        <span role="columnheader">
          <CustomerSortButton
            isActive={sortState.key === 'name'}
            label={uiText.customers.customer}
            onClick={() => onSortChange('name')}
            sortState={sortState}
          />
        </span>
        <span role="columnheader">
          <CustomerSortButton
            isActive={sortState.key === 'customerType'}
            label={uiText.customers.customerType}
            onClick={() => onSortChange('customerType')}
            sortState={sortState}
          />
        </span>
        <span role="columnheader">
          <CustomerSortButton
            isActive={sortState.key === 'city'}
            label={uiText.customers.city}
            onClick={() => onSortChange('city')}
            sortState={sortState}
          />
        </span>
        <span role="columnheader">{uiText.customers.contact}</span>
        <span role="columnheader">
          <CustomerSortButton
            isActive={sortState.key === 'status'}
            label={uiText.customers.status}
            onClick={() => onSortChange('status')}
            sortState={sortState}
          />
        </span>
        <span role="columnheader" aria-label={uiText.customers.actions} />
      </div>
      {customerGroups.map(({ customer, managedHousingCompanies }) => (
        <CustomerTableGroup
          customer={customer}
          customers={customers}
          isExpanded={expandedPropertyManagerIds.has(customer.id)}
          key={customer.id}
          managedHousingCompanies={managedHousingCompanies}
          onCustomerSelect={onCustomerSelect}
          onPropertyManagerToggle={onPropertyManagerToggle}
        />
      ))}
    </div>
  );
}

interface CustomerTableGroupProps {
  customer: Customer;
  customers: Customer[];
  isExpanded: boolean;
  managedHousingCompanies: Customer[];
  onCustomerSelect(customer: Customer): void;
  onPropertyManagerToggle(customerId: string): void;
}

function CustomerTableGroup({
  customer,
  customers,
  isExpanded,
  managedHousingCompanies,
  onCustomerSelect,
  onPropertyManagerToggle,
}: CustomerTableGroupProps): React.JSX.Element {
  const isPropertyManager = customer.customerType === 'propertyManager';
  const hasManagedHousingCompanies = managedHousingCompanies.length > 0;

  return (
    <div className={styles.group}>
      <div className={`${styles.row} ${styles.buttonRow}`}>
        <CustomerOpenButton
          customer={customer}
          customers={customers}
          managedHousingCompanyCount={managedHousingCompanies.length}
          onCustomerSelect={onCustomerSelect}
        />
        {isPropertyManager ? (
          <button
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? uiText.customers.collapseManagedHousingCompanies
                : uiText.customers.expandManagedHousingCompanies
            }
            className={styles.expandButton}
            disabled={!hasManagedHousingCompanies}
            onClick={() => onPropertyManagerToggle(customer.id)}
            type="button"
          >
            {isExpanded ? '-' : '+'}
          </button>
        ) : null}
      </div>
      {isPropertyManager && isExpanded
        ? managedHousingCompanies.map((housingCompany) => (
            <CustomerChildRow
              customer={housingCompany}
              key={housingCompany.id}
              onCustomerSelect={onCustomerSelect}
            />
          ))
        : null}
    </div>
  );
}

interface CustomerOpenButtonProps {
  customer: Customer;
  customers: Customer[];
  managedHousingCompanyCount: number;
  onCustomerSelect(customer: Customer): void;
}

function CustomerOpenButton({
  customer,
  customers,
  managedHousingCompanyCount,
  onCustomerSelect,
}: CustomerOpenButtonProps): React.JSX.Element {
  return (
    <button
      className={styles.openButton}
      onClick={() => onCustomerSelect(customer)}
      type="button"
    >
      <CustomerMainCell
        customer={customer}
        customers={customers}
        managedHousingCompanyCount={managedHousingCompanyCount}
      />
      <span role="cell">{getCustomerTypeLabel(customer.customerType)}</span>
      <span role="cell">{customer.city || '-'}</span>
      <span role="cell">{getPrimaryContact(customer)}</span>
      <CustomerStatusCell customer={customer} />
    </button>
  );
}

interface CustomerMainCellProps {
  customer: Customer;
  customers: Customer[];
  managedHousingCompanyCount: number;
}

function CustomerMainCell({
  customer,
  customers,
  managedHousingCompanyCount,
}: CustomerMainCellProps): React.JSX.Element {
  return (
    <span className={styles.mainCell}>
      <span className={styles.number}>{customer.customerNumber}</span>
      <strong>{customer.name}</strong>
      {customer.customerType === 'propertyManager' ? (
        <span className={styles.secondary}>
          {formatManagedHousingCompanyCount(managedHousingCompanyCount)}
        </span>
      ) : customer.customerType === 'housingCompany' ? (
        <span className={styles.secondary}>
          {getCustomerRelationshipLabel(customer, customers)}
        </span>
      ) : null}
    </span>
  );
}

interface CustomerChildRowProps {
  customer: Customer;
  onCustomerSelect(customer: Customer): void;
}

function CustomerChildRow({
  customer,
  onCustomerSelect,
}: CustomerChildRowProps): React.JSX.Element {
  return (
    <button
      className={`${styles.row} ${styles.button} ${styles.childRow}`}
      onClick={() => onCustomerSelect(customer)}
      type="button"
    >
      <span className={styles.mainCell}>
        <span className={styles.number}>{customer.customerNumber}</span>
        <strong>{customer.name}</strong>
        <span className={styles.secondary}>{uiText.customers.housingCompany}</span>
      </span>
      <span role="cell">{getCustomerTypeLabel(customer.customerType)}</span>
      <span role="cell">{customer.city || '-'}</span>
      <span role="cell">{getPrimaryContact(customer)}</span>
      <CustomerStatusCell customer={customer} />
      <span role="cell" />
    </button>
  );
}

function CustomerStatusCell({ customer }: { customer: Customer }): React.JSX.Element {
  return (
    <span role="cell">
      <span className={`status-pill status-pill-${customer.status}`}>
        {getCustomerStatusLabel(customer.status)}
      </span>
    </span>
  );
}

interface CustomerSortButtonProps {
  isActive: boolean;
  label: string;
  onClick(): void;
  sortState: CustomerSortState;
}

function CustomerSortButton({
  isActive,
  label,
  onClick,
  sortState,
}: CustomerSortButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={getSortButtonLabel(label, isActive, sortState)}
      className={styles.sortButton}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      {isActive ? <strong aria-hidden="true">{getSortIndicator(sortState)}</strong> : null}
    </button>
  );
}

function getSortButtonLabel(
  label: string,
  isActive: boolean,
  sortState: CustomerSortState,
): string {
  if (!isActive) {
    return `${uiText.customers.sortByColumn}: ${label}`;
  }

  return `${uiText.customers.sortByColumn}: ${label}, ${getSortDirectionLabel(sortState)}`;
}

function getSortIndicator(sortState: CustomerSortState): string {
  if (sortState.key === 'status') {
    return sortState.direction === 'asc'
      ? uiText.customers.activeFirstShort
      : uiText.customers.inactiveFirstShort;
  }

  return sortState.direction === 'asc' ? 'A-Ö' : 'Ö-A';
}
