import { app } from 'electron';

import {
  createW6b2PackagedProofBootstrapConfiguration,
  readW6b2PackagedProofConfiguration,
  W6B2_PACKAGED_PROOF_TOKEN_ENV,
} from '../src/main/w6b2PackagedProof.js';
import { readDesktopBuildInfo } from '../src/release/desktopBuildInfoReader.js';
import {
  prepareW6b2PackagedWorkspaceProfile,
  verifyW6b2PackagedWorkspaceProfile,
} from './w6b2PackagedWorkspaceProfile.js';
import {
  createW6b2PackagedProfileCommandResult,
  expectedW6b2PackagedProfilePackage,
  parseW6b2PackagedProfileOperation,
  resolveW6b2InstalledApplicationPaths,
  W6B2_PACKAGED_PROFILE_OPERATION_ENV,
  writeW6b2PackagedProfileCommandResult,
  type W6b2PackagedProfileOperation,
} from './w6b2PackagedWorkspaceProfileCommand.js';
import {
  readW6b2PackagedWorkspaceProfileInput,
  readW6b2PackagedWorkspaceProfileState,
} from './w6b2PackagedWorkspaceProfileState.js';

let operation: W6b2PackagedProfileOperation | undefined;
let proofRoot: string | undefined;

void run().then(
  () => app.exit(0),
  async () => {
    if (operation !== undefined && proofRoot !== undefined) {
      await writeW6b2PackagedProfileCommandResult(
        proofRoot,
        createW6b2PackagedProfileCommandResult({
          operation,
          succeeded: false,
        }),
      ).catch(() => undefined);
    }
    process.stdout.write(
      `${JSON.stringify({ status: 'failed', type: 'w6b2ProfileCommand' })}\n`,
    );
    app.exit(1);
  },
);

async function run(): Promise<void> {
  operation = parseW6b2PackagedProfileOperation(
    process.env[W6B2_PACKAGED_PROFILE_OPERATION_ENV],
  );
  const bootstrap = createW6b2PackagedProofBootstrapConfiguration({
    hasProofSwitch: true,
    tempPath: app.getPath('temp'),
    tokenValue: process.env[W6B2_PACKAGED_PROOF_TOKEN_ENV],
  });
  if (bootstrap.root === undefined || bootstrap.userDataPath === undefined) {
    throw new Error('W6B2_PROFILE_COMMAND_INVALID');
  }
  proofRoot = bootstrap.root;
  app.setPath('userData', bootstrap.userDataPath);
  await app.whenReady();

  const expected = expectedW6b2PackagedProfilePackage(operation);
  const installed = await resolveW6b2InstalledApplicationPaths(
    process.env.LOCALAPPDATA,
  );
  const proof = await readW6b2PackagedProofConfiguration({
    appVersion: expected.appVersion,
    bootstrap,
    resourcesPath: installed.resourcesPath,
  });
  if (
    proof === undefined ||
    proof.phase !== expected.phase ||
    proof.role !== expected.role
  ) {
    throw new Error('W6B2_PROFILE_COMMAND_INVALID');
  }
  const buildInfo = await readDesktopBuildInfo({
    applicationPath: installed.applicationPath,
    appVersion: expected.appVersion,
    isPackaged: true,
  });
  const expectedBuildRevision =
    operation === 'prepare'
      ? (await readW6b2PackagedWorkspaceProfileInput(proof.root))
          .sourceBuildRevision
      : (await readW6b2PackagedWorkspaceProfileState(proof.root))
          .buildRevision;
  if (
    buildInfo.buildDirty ||
    buildInfo.buildRevision !== expectedBuildRevision
  ) {
    throw new Error('W6B2_PROFILE_COMMAND_INVALID');
  }

  if (operation === 'prepare') {
    await prepareW6b2PackagedWorkspaceProfile({
      proofRoot: proof.root,
      resourcesPath: installed.resourcesPath,
      userDataRoot: proof.userDataPath,
    });
  } else {
    await verifyW6b2PackagedWorkspaceProfile({
      phase: operation,
      proofRoot: proof.root,
      userDataRoot: proof.userDataPath,
    });
  }
  await writeW6b2PackagedProfileCommandResult(
    proof.root,
    createW6b2PackagedProfileCommandResult({
      operation,
      succeeded: true,
    }),
  );
  process.stdout.write(
    `${JSON.stringify({ status: 'completed', type: 'w6b2ProfileCommand' })}\n`,
  );
}
