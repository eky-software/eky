import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { WorkspaceManagementStatus } from '../../app/desktopWorkspaceManagement.js';
import { WorkspaceManagementDialog } from './WorkspaceManagementDialog.js';
import type { WorkspaceSelectorState } from './workspaceSelectorState.js';

const activeWorkspaceId = '11111111-1111-4111-8111-111111111111';
const readyWorkspaceId = '22222222-2222-4222-8222-222222222222';
const recoveryWorkspaceId = '33333333-3333-4333-8333-333333333333';
const status: WorkspaceManagementStatus = {
  activeWorkspaceId,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [
    {
      availability: 'ready',
      isActive: true,
      workspaceId: activeWorkspaceId,
      workspaceLabel: 'Sama nimi',
    },
    {
      availability: 'ready',
      isActive: false,
      workspaceId: readyWorkspaceId,
      workspaceLabel: 'Sama nimi',
    },
    {
      availability: 'recoveryRequired',
      isActive: false,
      workspaceId: recoveryWorkspaceId,
      workspaceLabel: 'Tarkistettava yritys',
    },
  ],
};

describe('WorkspaceManagementDialog', () => {
  it('lists active, duplicate-labelled and recovery workspaces without destructive actions', () => {
    const html = renderDialog(createState());

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Yritykset');
    expect(html.match(/Sama nimi/g)).toHaveLength(2);
    expect(html).toContain('Aktiivinen yritys');
    expect(html).toContain('Valmis avattavaksi');
    expect(html).toContain('Vaatii palautuksen');
    expect(html).toContain('Avaa yritys');
    expect(html).toContain('Lisää yritys Ekyyn');
    expect(html).toContain('Tuo yritys varmuuskopiosta');
    expect(html).not.toContain('Korvaa aktiivisen yrityksen tiedot');
    expect(html).not.toContain('Poista yritys');
  });

  it.each([
    ['create', 'Lisää yritys Ekyyn', 'Luo yritys'],
    ['import', 'Tuo yritys varmuuskopiosta', 'Valitse varmuuskopio'],
    ['rename', 'Nimeä uudelleen', 'Tallenna nimi'],
    ['confirmSwitch', 'Avaa yritys', 'Vaihda yritys'],
  ] as const)('renders the %s operation as a labelled form', (mode, heading, action) => {
    const selectedWorkspaceId =
      mode === 'rename' || mode === 'confirmSwitch' ? readyWorkspaceId : null;
    const html = renderDialog(
      createState({
        labelInput: mode === 'rename' ? 'Sama nimi' : '',
        mode,
        selectedWorkspaceId,
      }),
    );

    expect(html).toContain('<form');
    expect(html).toContain(heading);
    expect(html).toContain(action);
    if (mode === 'import') {
      expect(html).toContain('.ekybackup');
      expect(html).not.toMatch(/tiedostopolku|salasana/i);
    }
    if (mode === 'confirmSwitch') {
      expect(html).toContain('Eky vaihtaa yrityksen ja käynnistyy uudelleen.');
      expect(html).toContain('data-autofocus="true"');
    } else {
      expect(html).toContain('data-autofocus="true"');
    }
  });

  it('disables mutation controls while global recovery is required', () => {
    const html = renderDialog(
      createState({
        status: { ...status, operationState: 'recoveryRequired' },
      }),
    );

    expect(html).toContain('odottaa palautuksen tarkistusta');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps relaunching visible and all operation controls disabled', () => {
    const html = renderDialog(
      createState({
        isSubmitting: true,
        mode: 'confirmSwitch',
        selectedWorkspaceId: readyWorkspaceId,
      }),
    );

    expect(html).toContain('Eky vaihtaa yrityksen ja käynnistyy uudelleen.');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

function createState(
  overrides: Partial<WorkspaceSelectorState> = {},
): WorkspaceSelectorState {
  return {
    errorMessage: null,
    isDialogOpen: true,
    isSubmitting: false,
    labelInput: '',
    loadState: 'ready',
    mode: 'list',
    selectedWorkspaceId: null,
    status,
    ...overrides,
  };
}

function renderDialog(state: WorkspaceSelectorState): string {
  return renderToStaticMarkup(
    <WorkspaceManagementDialog
      onClose={() => undefined}
      onLabelChange={() => undefined}
      onModeChange={() => undefined}
      onRetry={() => undefined}
      onSubmit={() => undefined}
      state={state}
    />,
  );
}
