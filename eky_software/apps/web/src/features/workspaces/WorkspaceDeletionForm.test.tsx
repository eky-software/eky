import type { FormHTMLAttributes, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { uiText } from '../../i18n/fi.js';
import { WorkspaceDeletionForm } from './WorkspaceDeletionForm.js';

type Props = Parameters<typeof WorkspaceDeletionForm>[0];
const workspaceId = '11111111-1111-4111-8111-111111111111';
const text = uiText.workspaces;
const props = (overrides: Partial<Props> = {}): Props => ({
  target: { workspaceId, workspaceLabel: 'Synthetic company' },
  showWorkspaceIdentifier: false, backupAvailable: true, typedLabel: '',
  backupChoice: null, isBusy: false, errorMessage: null,
  onTypedLabelChange: vi.fn(), onBackupChoiceChange: vi.fn(), onBack: vi.fn(), onSubmit: vi.fn(),
  ...overrides,
});
const html = (input: Props) => renderToStaticMarkup(<WorkspaceDeletionForm {...input} />);

describe('WorkspaceDeletionForm', () => {
  it('shows the exact target and removed/retained scope without preselecting data loss', () => {
    const output = html(props());
    expect(output).toContain('Synthetic company');
    expect(output).toContain(text.deleteRemovedData);
    expect(output).toContain(text.deleteRetainedData);
    expect(output).toContain(text.deleteTypedLabel);
    expect(output).toContain('aria-describedby=');
    expect(output).toContain('data-autofocus="true"');
    expect(output).toMatch(/maxlength="160"/i);
    expect(output).not.toContain('checked=""');
    expect(output).not.toContain('Ty\u00f6tilan tunniste:');
    expect(output).toContain('type="submit" disabled=""');
  });

  it('shows only an explicitly requested safe duplicate-name discriminator', () => {
    expect(html(props({ showWorkspaceIdentifier: true }))).toContain(text.workspaceIdentifier(workspaceId));
  });

  it('does not offer a fictitious backup for a closed target', () => {
    const output = html(props({ backupAvailable: false }));
    expect(output).toContain(text.deleteBackupUnavailable);
    expect(output).not.toContain(text.deleteCreateBackup);
    expect(output).toContain(text.deleteWithoutBackup);
    expect(output).not.toContain('checked=""');
  });

  it.each([
    {}, { typedLabel: 'Synthetic company' }, { backupChoice: 'explicitDataLoss' },
    { typedLabel: 'synthetic company', backupChoice: 'explicitDataLoss' },
    { typedLabel: 'Synthetic company ', backupChoice: 'explicitDataLoss' },
    { typedLabel: 'Synthetic company', backupChoice: 'createBackup', backupAvailable: false },
    { typedLabel: 'Synthetic company', backupChoice: 'explicitDataLoss', isBusy: true },
    { typedLabel: 'Synthetic company', backupChoice: 'explicitDataLoss',
      target: { workspaceId: 'invalid', workspaceLabel: 'Synthetic company' } },
  ] satisfies Partial<Props>[])('blocks submission at case %# even when the form handler is called directly', change => {
    const input = props(change);
    const preventDefault = submit(input);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(input.onSubmit).not.toHaveBeenCalled();
  });

  it.each(['createBackup', 'explicitDataLoss'] as const)('submits only the validated %s request, not final deletion', backupChoice => {
    const input = props({ typedLabel: 'Synthetic company', backupChoice });
    submit(input);
    expect(input.onSubmit).toHaveBeenCalledOnce();
    expect(input.onSubmit).toHaveBeenCalledWith({ formatVersion: 1, workspaceId,
      typedLabel: 'Synthetic company', backupChoice });
    expect(Object.isFrozen(vi.mocked(input.onSubmit).mock.calls[0]![0])).toBe(true);
  });

  it('accepts the same canonical Unicode name as main and escapes target markup', () => {
    const input = props({ target: { workspaceId, workspaceLabel: 'Yhti\u00f6' },
      typedLabel: 'Yhtio\u0308', backupChoice: 'explicitDataLoss' });
    submit(input);
    expect(input.onSubmit).toHaveBeenCalledOnce();
    const output = html(props({ target: { workspaceId, workspaceLabel: '<img src=x onerror=bad>' } }));
    expect(output).not.toContain('<img');
    expect(output).toContain('&lt;img');
  });

  it('announces pending work and a safe error while disabling all actionable controls', () => {
    const output = html(props({ isBusy: true, errorMessage: text.safeError }));
    expect(output).toContain('aria-busy="true"');
    expect(output).toContain('role="alert"');
    expect(output).toContain(text.safeError);
    expect(output).toContain('role="status"');
    expect(output).toContain(text.deleteProcessing);
    expect(output).toContain('<fieldset');
    expect(output.match(/disabled=""/g)).toHaveLength(4);
  });
});

function submit(input: Props) {
  const form = WorkspaceDeletionForm(input) as ReactElement<FormHTMLAttributes<HTMLFormElement>>;
  const preventDefault = vi.fn();
  form.props.onSubmit?.({ preventDefault } as unknown as
    Parameters<NonNullable<FormHTMLAttributes<HTMLFormElement>['onSubmit']>>[0]);
  return preventDefault;
}
