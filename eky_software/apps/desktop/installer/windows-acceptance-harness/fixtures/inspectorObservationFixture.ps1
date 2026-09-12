param(
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$ObservationPath,
  [Parameter(Mandatory = $true)]
  [ValidateSet('completed', 'queryFailure', 'observerFailure', 'comHold')][string]$Mode
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The listener belongs only to the synthetic contract fixture. The real reader
# emits no files; this receipt lets a test inspect events after exact Job cleanup.
class InspectorContractListener : System.Diagnostics.Tracing.EventListener {
  static [string]$Path
  static [bool]$FailObserver
  static [System.Collections.Generic.List[object]]$Events = [System.Collections.Generic.List[object]]::new()
  [void] OnEventSourceCreated([System.Diagnostics.Tracing.EventSource]$source) {
    if ($source.Name -ceq 'Eky-InstallerProductInspection-V1') {
      $this.EnableEvents($source, [System.Diagnostics.Tracing.EventLevel]::Verbose)
    }
  }
  [void] OnEventWritten([System.Diagnostics.Tracing.EventWrittenEventArgs]$event) {
    if ($event.EventName -ceq 'EventSourceMessage') { return }
    [InspectorContractListener]::Events.Add([ordered]@{
      phase = $event.EventName
      payloadCount = $(if ($null -eq $event.Payload) { 0 } else { $event.Payload.Count })
    })
    $json = [ordered]@{ schemaVersion = 1; events = [InspectorContractListener]::Events } |
      ConvertTo-Json -Depth 4 -Compress
    [IO.File]::WriteAllText([InspectorContractListener]::Path, $json, [Text.UTF8Encoding]::new($false))
    if ([InspectorContractListener]::FailObserver) { throw 'syntheticObserverFailure' }
  }
}
[InspectorContractListener]::Path = $ObservationPath
[InspectorContractListener]::FailObserver = $Mode -ceq 'observerFailure'
$listener = [InspectorContractListener]::new()
try {
  function New-Object {
    param([string]$ComObject)
    if ($ComObject -cne 'WindowsInstaller.Installer') { throw 'unexpectedComRequest' }
    if ($Mode -ceq 'comHold') {
      # Deliberate wait at the actual COM boundary, owned by the existing Job.
      $held = [Threading.ManualResetEvent]::new($false)
      [void]$held.WaitOne()
    }
    if ($Mode -ceq 'queryFailure') { return Microsoft.PowerShell.Utility\New-Object -ComObject Scripting.Dictionary }
    Microsoft.PowerShell.Utility\New-Object -ComObject $ComObject
  }
  & "$PSScriptRoot\..\inspectWindowsInstallerProductState.ps1" `
    -ProductCode '{00000000-0000-0000-0000-000000000000}' -ResultPath $ResultPath
  exit $LASTEXITCODE
} finally {
  $listener.Dispose()
}
