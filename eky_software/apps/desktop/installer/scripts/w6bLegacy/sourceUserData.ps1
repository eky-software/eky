Set-StrictMode -Version Latest

function Initialize-W6bNativePathResolver {
  if ($null -ne ('Eky.W6b.NativePath' -as [type])) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.W6b
{
    public static class NativePath
    {
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint FileShareDelete = 0x00000004;
        private const uint OpenExisting = 3;
        private const uint FileFlagBackupSemantics = 0x02000000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder filePath,
            uint filePathLength,
            uint flags);

        public static string Resolve(string path)
        {
            SafeFileHandle handle = CreateFileW(
                path,
                0,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics,
                IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error);
            }

            try
            {
                StringBuilder buffer = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandleW(
                    handle,
                    buffer,
                    (uint)buffer.Capacity,
                    0);
                if (length == 0 || length >= buffer.Capacity)
                {
                    throw new IOException("W6B_NATIVE_PATH_RESOLUTION_FAILED");
                }

                string value = buffer.ToString();
                if (value.StartsWith(@"\\?\UNC\", StringComparison.Ordinal))
                {
                    return @"\\" + value.Substring(8);
                }
                if (value.StartsWith(@"\\?\", StringComparison.Ordinal))
                {
                    return value.Substring(4);
                }
                return value;
            }
            finally
            {
                handle.Dispose();
            }
        }
    }
}
'@
}

function Resolve-W6bCanonicalExistingPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw $Code
  }
  try {
    Initialize-W6bNativePathResolver
    return [IO.Path]::GetFullPath([Eky.W6b.NativePath]::Resolve($Path))
  }
  catch {
    throw $Code
  }
}

function Test-W6bCanonicalPathContained {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $normalizedRoot = $Root.TrimEnd('\')
  return (
    $Candidate.Equals(
      $normalizedRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    $Candidate.StartsWith(
      "$normalizedRoot\",
      [StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Assert-W6bPathSegmentsAreRegular {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if (!(Test-W6bCanonicalPathContained -Candidate $Candidate -Root $Root)) {
    throw $Code
  }
  $relative = $Candidate.Substring($Root.TrimEnd('\').Length).TrimStart('\')
  $segments = @($relative.Split('\') | Where-Object { $_ -ne '' })
  $current = $Root.TrimEnd('\')
  $paths = @($current)
  foreach ($segment in $segments) {
    $current = Join-Path $current $segment
    $paths += $current
  }
  foreach ($path in $paths) {
    $metadata = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw $Code
    }
  }
}

function Resolve-W6bLegacySourceUserData {
  param(
    [Parameter(Mandatory = $true)][string]$SourceSmokeTempRoot,
    [Parameter(Mandatory = $true)][string]$SourceSmokeToken,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision,
    [Parameter(Mandatory = $true)][scriptblock]$ReadAcceptedBuild
  )

  if (
    $SourceSmokeToken -cnotmatch '^[0-9a-f]{32}$' -or
    $ExpectedVersion -cnotmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedRevision -cnotmatch '^[0-9a-f]{7,40}$'
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INPUT_INVALID'
  }

  try {
    $smokeTempMetadata = Get-Item -LiteralPath $SourceSmokeTempRoot `
      -Force -ErrorAction Stop
  }
  catch {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  if (
    !$smokeTempMetadata.PSIsContainer -or
    ($smokeTempMetadata.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }
  $canonicalSmokeTempRoot = Resolve-W6bCanonicalExistingPath `
    -Path $SourceSmokeTempRoot `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  $expectedUserDataPath = Join-Path `
    (Join-Path `
      (Join-Path $canonicalSmokeTempRoot 'eky-desktop-smoke') `
      $SourceSmokeToken) `
    'user-data'
  Assert-W6bPathSegmentsAreRegular `
    -Root $canonicalSmokeTempRoot `
    -Candidate ([IO.Path]::GetFullPath($expectedUserDataPath)) `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  $canonicalUserDataPath = Resolve-W6bCanonicalExistingPath `
    -Path $expectedUserDataPath `
    -Code 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  if (
    !(Test-W6bCanonicalPathContained `
      -Candidate $canonicalUserDataPath `
      -Root $canonicalSmokeTempRoot)
  ) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }

  $relativeUserDataPath = $canonicalUserDataPath.Substring(
    $canonicalSmokeTempRoot.TrimEnd('\').Length
  ).TrimStart('\')
  $expectedRelativePath = Join-Path `
    (Join-Path 'eky-desktop-smoke' $SourceSmokeToken) `
    'user-data'
  if ($relativeUserDataPath -cne $expectedRelativePath) {
    throw 'W6B_LEGACY_SOURCE_USER_DATA_INVALID'
  }

  $acceptedLocations = @(
    [pscustomobject]@{
      Classification = 'current'
      Path = Join-Path $canonicalUserDataPath `
        'update-state\accepted-build-v1.json'
    },
    [pscustomobject]@{
      Classification = 'legacy'
      Path = Join-Path $canonicalUserDataPath `
        'runtime\update-state\accepted-build-v1.json'
    }
  )
  $presentLocations = @(
    $acceptedLocations | Where-Object {
      Test-Path -LiteralPath $_.Path
    }
  )
  if ($presentLocations.Count -ne 1) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_COUNT_INVALID'
  }
  $acceptedLocation = $presentLocations[0]
  Assert-W6bPathSegmentsAreRegular `
    -Root $canonicalUserDataPath `
    -Candidate ([IO.Path]::GetFullPath($acceptedLocation.Path)) `
    -Code 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  $acceptedPath = Resolve-W6bCanonicalExistingPath `
    -Path $acceptedLocation.Path `
    -Code 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  if (
    !(Test-W6bCanonicalPathContained `
      -Candidate $acceptedPath `
      -Root $canonicalUserDataPath)
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }
  $acceptedMetadata = Get-Item -LiteralPath $acceptedPath -Force
  if ($acceptedMetadata.PSIsContainer) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_INVALID'
  }

  $accepted = & $ReadAcceptedBuild $acceptedPath
  if (
    $null -eq $accepted -or
    [string]$accepted.appVersion -cne $ExpectedVersion -or
    [string]$accepted.buildRevision -cne $ExpectedRevision
  ) {
    throw 'W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH'
  }

  return [pscustomobject]@{
    AcceptedBuild = $accepted
    AcceptedBuildLocation = $acceptedLocation.Classification
    Root = $canonicalUserDataPath
  }
}
