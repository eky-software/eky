export type PackageArtifactStage = 'applicationStage' | 'backendStage' | 'desktopRuntimeStage' |
  'updateRuntimeStage' | 'profileInspectionNativeStage' | 'packagedApp';

export function inspectPackageArtifactInventory(options: {
  root: string;
  stage: PackageArtifactStage;
  onValidatedFiles?: (files: readonly string[]) => void;
}): Promise<Readonly<{ fileCount: number; identity: string; stage: PackageArtifactStage; totalByteSize: number }>>;
