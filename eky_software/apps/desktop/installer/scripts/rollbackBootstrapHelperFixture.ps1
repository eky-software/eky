param(
  [string]$MsiExecPath,
  [string]$FailedProductCode,
  [int]$LauncherProcessId,
  [string]$FailedPackagePath,
  [string]$RollbackPackagePath,
  [string]$ProgressPath
)
$ErrorActionPreference = 'Stop'
$inputData = [IO.File]::ReadAllText($ProgressPath) | ConvertFrom-Json
$pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $inputData.pipeName, [IO.Pipes.PipeDirection]::InOut)
try {
  # The V2 Job owns this fixture's entire lifetime, including connection/read.
  $pipe.Connect()
  $reader = [IO.StreamReader]::new($pipe)
  $writer = [IO.StreamWriter]::new($pipe)
  $writer.AutoFlush = $true
  $writer.WriteLine($inputData.runNonce + ':started')
  if ($inputData.testCase -eq 'earlyHelperExit') { exit 7 }
  if ($reader.ReadLine() -cne 'probe') { exit 8 }
  $writer.WriteLine($inputData.runNonce + ':alive')
  if ($reader.ReadLine() -cne 'release') { exit 9 }
  $writer.WriteLine($inputData.runNonce + ':completed')
} finally {
  $pipe.Dispose()
}
