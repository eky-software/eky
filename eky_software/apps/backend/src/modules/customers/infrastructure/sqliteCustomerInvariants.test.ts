import { createActorContext } from '@eky/auth';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { createCustomer, type CreateCustomerInput } from '../application/createCustomer.js';
import { updateCustomer, type UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';
import {
  createCustomerCreatedAuditEvent,
  createCustomerUpdatedAuditEvent,
} from '../domain/customerAuditEvent.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import { SqliteCustomerRepository } from './sqliteCustomerRepository.js';

const actorContext = createActorContext({
  actorId: 'local-owner', authenticationMode: 'local', companyId: 'company-a', permissions: [],
});

describe('Customers write invariants', () => {
  let database: DatabaseConnection;
  let repository: SqliteCustomerRepository;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
    repository = new SqliteCustomerRepository(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it.each(['active', 'inactive'] as const)(
    'rejects retyping the manager of an %s housing company without changing data or audit',
    async (status) => {
      const manager = await createCustomer(input({ customerType: 'propertyManager' }), repository);
      const housing = await createCustomer(input({
        customerNumber: '2002', customerType: 'housingCompany', managedByCustomerId: manager.id, status,
      }), repository);
      const auditBefore = auditCount(database);

      await expect(updateCustomer(update(manager, { customerType: 'company' }), repository))
        .rejects.toThrow('Referenced property manager type cannot be changed.');

      expect(await repository.findById(actorContext.companyId, manager.id)).toEqual(manager);
      expect(await repository.findById(actorContext.companyId, housing.id)).toEqual(housing);
      expect(auditCount(database)).toBe(auditBefore);
    },
  );

  it.each(['remove', 'transfer'] as const)(
    'allows other manager edits and retyping after an explicit reference %s', async (action) => {
    const manager = await createCustomer(input({ customerType: 'propertyManager' }), repository);
    const housing = await createCustomer(input({
      customerNumber: '2002', customerType: 'housingCompany', managedByCustomerId: manager.id,
    }), repository);
    const edited = await updateCustomer(update(manager, { name: 'Updated manager', status: 'inactive' }), repository);
    expect(edited.customerType).toBe('propertyManager');
    const nextManager = action === 'transfer'
      ? await createCustomer(input({ customerNumber: '3001', customerType: 'propertyManager' }), repository)
      : undefined;
    await updateCustomer(update(housing, { managedByCustomerId: nextManager?.id ?? '' }), repository);
    expect((await updateCustomer(update(edited, { customerType: 'company' }), repository)).customerType)
      .toBe('company');
    expect((await repository.findById(housing.companyId, housing.id))?.managedByCustomerId)
      .toBe(nextManager?.id ?? '');
  });

  it('does not let another company reference affect a type change', async () => {
    const manager = await createCustomer(input({ customerType: 'propertyManager' }), repository);
    const other = await createCustomer(input({
      actorContext: { ...actorContext, companyId: 'company-b' }, customerType: 'housingCompany',
    }), repository);
    database.prepare('UPDATE customers SET managed_by_customer_id = ? WHERE id = ?')
      .run(manager.id, other.id);

    expect((await updateCustomer(update(manager, { customerType: 'company' }), repository)).customerType)
      .toBe('company');
    expect((await repository.findById(other.companyId, other.id))?.managedByCustomerId).toBe(manager.id);
  });

  it.each(['create', 'update'] as const)(
    'rejects retyping when a reference %s commits after the application read', async (operation) => {
    const manager = await createCustomer(input({ customerType: 'propertyManager' }), repository);
    const housing = operation === 'update'
      ? await createCustomer(input({ customerNumber: '2002', customerType: 'housingCompany' }), repository)
      : undefined;
    const gate = pauseNextRead(repository);
    const result = updateCustomer(update(manager, { customerType: 'company' }), repository)
      .catch((error: unknown) => error);
    await gate.entered;
    let outcome: unknown;
    try {
      if (housing === undefined) {
        await createCustomer(input({
          customerNumber: '2002', customerType: 'housingCompany', managedByCustomerId: manager.id,
        }), repository);
      } else {
        await updateCustomer(update(housing, { managedByCustomerId: manager.id }), repository);
      }
    } finally {
      gate.release();
      outcome = await result;
    }

    expect(outcome).toBeInstanceOf(CustomerValidationError);
    expect((await repository.findById(manager.companyId, manager.id))?.customerType).toBe('propertyManager');
    expect(auditCount(database)).toBe(operation === 'create' ? 2 : 3);
  });

  it.each(['create', 'update'] as const)(
    'rejects a stale manager reference in %s after the manager type change commits',
    async (operation) => {
      const manager = await createCustomer(input({ customerType: 'propertyManager' }), repository);
      const housing = operation === 'update'
        ? await createCustomer(input({ customerNumber: '2002', customerType: 'housingCompany' }), repository)
        : undefined;
      const gate = pauseNextRead(repository, operation === 'update' ? 2 : 1);
      const pending = housing === undefined
        ? createCustomer(input({
            customerNumber: '2002', customerType: 'housingCompany', managedByCustomerId: manager.id,
          }), repository)
        : updateCustomer(update(housing, { managedByCustomerId: manager.id }), repository);
      const result = pending.catch((error: unknown) => error);
      await gate.entered;
      let outcome: unknown;
      try {
        await updateCustomer(update(manager, { customerType: 'company' }), repository);
      } finally {
        gate.release();
        outcome = await result;
      }

      expect(outcome).toBeInstanceOf(CustomerValidationError);
      const rows = await repository.listByCompanyId(actorContext.companyId);
      expect(rows.filter((row) => row.managedByCustomerId === manager.id)).toEqual([]);
      expect(auditCount(database)).toBe(operation === 'create' ? 2 : 3);
    },
  );

  it('checks the stored type when the application observed an older non-manager type', async () => {
    const original = await createCustomer(input(), repository);
    const gate = pauseNextRead(repository);
    const pending = updateCustomer(update(original, { name: 'Stale proposed edit' }), repository)
      .catch((error: unknown) => error);
    await gate.entered;
    let outcome: unknown;
    try {
      await updateCustomer(update(original, { customerType: 'propertyManager' }), repository);
      await createCustomer(input({
        customerNumber: '2002', customerType: 'housingCompany', managedByCustomerId: original.id,
      }), repository);
    } finally {
      gate.release();
      outcome = await pending;
    }
    expect(outcome).toMatchObject({ message: 'Referenced property manager type cannot be changed.' });
    expect((await repository.findById(original.companyId, original.id))?.customerType).toBe('propertyManager');
    expect(auditCount(database)).toBe(3);
  });

  it.each([
    ['create', 'self'], ['update', 'self'], ['create', 'foreign'], ['update', 'foreign'],
  ] as const)('rejects a %s-port %s manager reference without writing', async (operation, kind) => {
    const foreign = await createCustomer(input({
      actorContext: { ...actorContext, companyId: 'company-b' }, customerType: 'propertyManager',
    }), repository);
    const housing = await createCustomer(input({ customerType: 'housingCompany' }), repository);
    const candidate = {
      ...housing, id: operation === 'create' ? 'new-local-housing' : housing.id,
      customerNumber: operation === 'create' ? '3001' : housing.customerNumber,
      name: 'Must not be committed',
    };
    candidate.managedByCustomerId = kind === 'self' ? candidate.id : foreign.id;
    const auditBefore = auditCount(database);
    const attempted = operation === 'create'
      ? repository.create(candidate, createCustomerCreatedAuditEvent({ actorUserId: actorContext.actorId, customer: candidate }))
      : repository.update(candidate, createCustomerUpdatedAuditEvent({
          actorUserId: actorContext.actorId, current: housing, updated: candidate,
        }));
    await expect(attempted).rejects.toThrow(kind === 'self'
      ? 'Customer cannot manage itself.' : 'Managed by customer must be a property manager.');
    expect(await repository.listByCompanyId(actorContext.companyId)).toEqual([housing]);
    expect(await repository.findById(foreign.companyId, foreign.id)).toEqual(foreign);
    expect(auditCount(database)).toBe(auditBefore);
  });

  it.each(['create', 'update'] as const)('keeps data and audit unchanged after a %s number collision', async (operation) => {
    const first = await createCustomer(input(), repository);
    const second = await createCustomer(input({ customerNumber: '2002' }), repository);
    const before = await repository.listByCompanyId(actorContext.companyId);
    const attempt = operation === 'create'
      ? createCustomer(input({ customerNumber: first.customerNumber }), repository)
      : updateCustomer(update(second, { customerNumber: first.customerNumber, name: 'Must not be committed' }), repository);
    await expect(attempt).rejects.toThrow('Customer number already exists.');
    expect(await repository.listByCompanyId(actorContext.companyId)).toEqual(before);
    expect(auditCount(database)).toBe(2);
  });

  it.each([
    ['9007199254740991', '9007199254740992'],
    ['9007199254740992', '9007199254740993'],
    ['9'.repeat(49), `1${'0'.repeat(49)}`],
  ])('increments %s exactly as a string', async (manual, expected) => {
    await createCustomer(input({ customerNumber: manual }), repository);
    const automatic = await createCustomer(input({ customerNumberMode: 'auto' }), repository);
    expect(automatic.customerNumber).toBe(expected);
  });

  it('preserves the baseline, leading-zero values, alphanumeric values and company isolation', async () => {
    await createCustomer(input({ customerNumber: 'ABC-999999' }), repository);
    await createCustomer(input({ customerNumber: '00002000' }), repository);
    expect(await repository.getNextCustomerNumber(actorContext.companyId)).toBe('2001');
    expect(await repository.getNextCustomerNumber('company-b')).toBe('1001');
    expect((await repository.listByCompanyId(actorContext.companyId)).map((row) => row.customerNumber).sort())
      .toEqual(['00002000', 'ABC-999999']);
  });

  it('rejects automatic numbering beyond 50 digits before any data or audit write', async () => {
    const existing = await createCustomer(input({ customerNumber: '9'.repeat(50) }), repository);
    await expect(createCustomer(input({ customerNumberMode: 'auto' }), repository))
      .rejects.toThrow('Customer number range is exhausted.');
    expect(await repository.listByCompanyId(actorContext.companyId)).toEqual([existing]);
    expect(auditCount(database)).toBe(1);
  });
});

function input(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    actorContext, businessId: '', city: '', comment: '', customerNumber: '2001',
    customerNumberMode: 'manual', customerType: 'company', email: '',
    hourlyRateOverrideCents: null, managedByCustomerId: '', name: 'Synthetic customer',
    phone: '', postalCode: '', status: 'active', streetAddress: '', ...overrides,
  };
}

function update(customer: Customer, overrides: Partial<UpdateCustomerInput> = {}): UpdateCustomerInput {
  return { ...customer, actorContext: { ...actorContext, companyId: customer.companyId }, ...overrides };
}

function auditCount(database: DatabaseConnection): number {
  return (database.prepare('SELECT COUNT(*) AS count FROM customer_audit_events').get() as { count: number }).count;
}

function pauseNextRead(repository: SqliteCustomerRepository, readIndex = 1) {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const original = repository.findById.bind(repository);
  let remaining = readIndex;
  vi.spyOn(repository, 'findById').mockImplementation(async (...args) => {
    const customer = await original(...args);
    remaining -= 1;
    if (remaining === 0) {
      markEntered();
      await released;
    }
    return customer;
  });
  return { entered, release };
}
