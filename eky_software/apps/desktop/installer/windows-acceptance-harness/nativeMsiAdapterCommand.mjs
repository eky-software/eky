import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_MSI_ADAPTER = resolve(dirname(fileURLToPath(import.meta.url)),
  '../bin/native-msi-test-adapter/Release/net10.0/Eky.NativeMsiTestAdapter.dll');

// Arguments only: the existing caller retains launch, deadline, result and cleanup ownership.
export function createNativeProductInspectionCommand(productCode, resultPath, environment = process.env) {
  return { command: environment.EKY_DOTNET_EXE || 'dotnet',
    arguments: [NATIVE_MSI_ADAPTER, '--inspect-product', '--product-code', productCode, '--result-path', resultPath] };
}
