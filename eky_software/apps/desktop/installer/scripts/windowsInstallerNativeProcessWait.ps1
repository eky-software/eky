Set-StrictMode -Version Latest

if ($null -eq ('Eky.Installer.Tests.NativeProcessWait' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Eky.Installer.Tests
{
    public static class NativeProcessWait
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(
            IntPtr handle,
            uint milliseconds
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetExitCodeProcess(
            IntPtr processHandle,
            out uint exitCode
        );
    }
}
'@
}

$script:EkyNativeWaitObjectSignaled = [uint32]0
$script:EkyNativeWaitTimedOut = [uint32]258
$script:EkyNativeProcessStillActive = [uint32]259

function Wait-EkyNativeProcessSignal {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )

  if ($TimeoutMilliseconds -lt 1) {
    throw 'INSTALLER_MSI_PROCESS_WAIT_INVALID'
  }

  try {
    $waitResult = [Eky.Installer.Tests.NativeProcessWait]::WaitForSingleObject(
      $Process.Handle,
      [uint32]$TimeoutMilliseconds
    )
  }
  catch {
    throw 'INSTALLER_MSI_PROCESS_WAIT_FAILED'
  }

  if ($waitResult -eq $script:EkyNativeWaitObjectSignaled) {
    return $true
  }
  if ($waitResult -eq $script:EkyNativeWaitTimedOut) {
    return $false
  }
  throw 'INSTALLER_MSI_PROCESS_WAIT_FAILED'
}

function Get-EkyNativeProcessExitCode {
  param([Parameter(Mandatory = $true)]$Process)

  try {
    [uint32]$exitCode = 0
    $read = [Eky.Installer.Tests.NativeProcessWait]::GetExitCodeProcess(
      $Process.Handle,
      [ref]$exitCode
    )
  }
  catch {
    throw 'INSTALLER_MSI_PROCESS_WAIT_FAILED'
  }
  if (
    !$read -or
    $exitCode -eq $script:EkyNativeProcessStillActive -or
    $exitCode -gt [uint32][int]::MaxValue
  ) {
    throw 'INSTALLER_MSI_PROCESS_WAIT_FAILED'
  }
  return [int]$exitCode
}
