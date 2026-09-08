function fail(code) { throw new Error(code); }

function present(product) {
  return product.productState >= 1 || product.productName !== null ||
    product.productVersion !== null || product.localPackagePresent;
}

// Shared read-only assertion, not a process or installer owner.
export function requireWorkspaceInstalledState(state, installed, versions) {
  if (state.ekyProcessCount !== 0 || state.source.ownedRegistryExists !== state.target.ownedRegistryExists) {
    fail('productInspectionFailed');
  }
  for (const role of ['source', 'target']) {
    const product = state[role];
    if (role === installed) {
      if (product.productState < 1 || product.productName !== 'Eky' ||
        product.productVersion !== versions[role] || !product.localPackagePresent ||
        !product.ownedRegistryExists) fail(`${role}StateInvalid`);
    } else if (present(product)) fail(installed === null ? 'preconditionFailed' : `${installed}StateInvalid`);
  }
  if (['installRootExists', 'executableExists', 'shortcutExists', 'installerRegistryExists']
    .some((key) => state[key] !== (installed !== null))) {
    fail(installed === null ? 'preconditionFailed' : `${installed}StateInvalid`);
  }
}
