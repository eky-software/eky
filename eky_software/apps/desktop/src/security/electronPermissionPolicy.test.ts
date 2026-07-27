import { describe, expect, it, vi } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { registerElectronPermissionPolicy } from './electronPermissionPolicy.js';

describe('Electron permission policy', () => {
  it('denies permission checks without creating a security event', () => {
    const fixture = createFixture();

    expect(
      fixture.checkHandler?.(
        null,
        'notifications',
        'eky://app/',
        { isMainFrame: true },
      ),
    ).toBe(false);
    expect(fixture.events).toEqual([]);
  });

  it('denies and records an allowlisted permission request once per runtime', () => {
    const fixture = createFixture();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const details = {
      isMainFrame: true,
      requestingUrl: 'eky://app/customers?secret=must-not-leak',
    };

    fixture.requestHandler?.(
      {} as never,
      'notifications',
      firstCallback,
      details,
    );
    fixture.requestHandler?.(
      {} as never,
      'notifications',
      secondCallback,
      details,
    );

    expect(firstCallback).toHaveBeenCalledWith(false);
    expect(secondCallback).toHaveBeenCalledWith(false);
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventName: 'electron.permissionRequestBlocked',
        frameClass: 'mainFrame',
        originClass: 'eky',
        permissionType: 'notifications',
        stage: 'request',
      }),
    ]);
    expect(JSON.stringify(fixture.events)).not.toContain('customers');
    expect(JSON.stringify(fixture.events)).not.toContain('must-not-leak');
  });

  it('classifies external and unknown requests without recording their URL', () => {
    const fixture = createFixture();

    fixture.requestHandler?.(
      {} as never,
      'openExternal',
      vi.fn(),
      {
        isMainFrame: false,
        requestingUrl: 'https://example.test/private?token=secret',
      },
    );
    fixture.requestHandler?.(
      {} as never,
      'unknown',
      vi.fn(),
      {
        isMainFrame: true,
        requestingUrl: 'not a URL',
      },
    );

    expect(fixture.events).toEqual([
      expect.objectContaining({
        frameClass: 'subFrame',
        originClass: 'external',
        permissionType: 'openExternal',
      }),
      expect.objectContaining({
        frameClass: 'mainFrame',
        originClass: 'unknown',
        permissionType: 'unknown',
      }),
    ]);
    expect(JSON.stringify(fixture.events)).not.toContain('example.test');
    expect(JSON.stringify(fixture.events)).not.toContain('token');
  });
});

function createFixture() {
  let checkHandler:
    | Parameters<
        Parameters<
          typeof registerElectronPermissionPolicy
        >[0]['permissionSession']['setPermissionCheckHandler']
      >[0]
    | undefined;
  let requestHandler:
    | Parameters<
        Parameters<
          typeof registerElectronPermissionPolicy
        >[0]['permissionSession']['setPermissionRequestHandler']
      >[0]
    | undefined;
  const events: DesktopOperationalEvent[] = [];

  registerElectronPermissionPolicy({
    operationalIdentity: {
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: {
      write(event) {
        events.push(event);
      },
    },
    permissionSession: {
      setPermissionCheckHandler(handler) {
        checkHandler = handler;
      },
      setPermissionRequestHandler(handler) {
        requestHandler = handler;
      },
    },
  });

  return { checkHandler, events, requestHandler };
}
