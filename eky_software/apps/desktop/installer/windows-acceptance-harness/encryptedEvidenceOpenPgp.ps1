# Dot-source in PowerShell 7 on Windows. The caller owns private directories,
# immutable input collection, retention and upload of ONLY the final output.
function ConvertTo-EvidenceGpgPath([string]$Path) {
  # Git's bundled GPG uses MSYS paths even when launched by native PowerShell.
  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath -notmatch '^[A-Za-z]:[\\/]') { throw 'EVIDENCE_INPUT_INVALID' }
  return '/' + $fullPath.Substring(0, 1).ToLowerInvariant() + $fullPath.Substring(2).Replace('\', '/')
}

function Invoke-EvidenceGpgProcess {
  param([string]$Executable, [string[]]$Arguments, [string]$HomePath,
    [string]$ErrorPath, [int]$TimeoutMilliseconds = 30000,
    [Diagnostics.Stopwatch]$Lifetime = [Diagnostics.Stopwatch]::StartNew(),
    [int]$TotalBudgetMilliseconds = 88000,
    [int]$StreamLimitBytes = 65536)

  # All steps share this deadline, with a separate two-second stop reserve.
  $remaining = [Math]::Min($TimeoutMilliseconds, $TotalBudgetMilliseconds - $Lifetime.ElapsedMilliseconds)
  if ($remaining -le 0) { throw 'EVIDENCE_GPG_TIMEOUT' }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $process = [Diagnostics.Process]::new()
  $output = [IO.MemoryStream]::new()
  $errors = $null
  $started = $false
  try {
    $errors = [IO.File]::Open($ErrorPath, 'CreateNew', 'Write', 'Read')
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = $HomePath
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.Environment['GNUPGHOME'] = ConvertTo-EvidenceGpgPath $HomePath
    [void]$info.Environment.Remove('GPG_AGENT_INFO')
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process.StartInfo = $info
    $started = $process.Start()
    if (!$started) { throw 'EVIDENCE_GPG_FAILED' }
    $process.StandardInput.Close()
    $channels = @(
      @{ Source = $process.StandardOutput.BaseStream; Sink = $output },
      @{ Source = $process.StandardError.BaseStream; Sink = $errors }
    )
    foreach ($channel in $channels) {
      $channel.Buffer = [byte[]]::new(4096)
      $channel.Count = 0
      $channel.Done = $false
      $channel.Pending = $channel.Source.ReadAsync($channel.Buffer, 0, $channel.Buffer.Length)
    }
    # Drain both pipes concurrently without an unbounded ReadToEnd allocation.
    while ($true) {
      foreach ($channel in $channels) {
        if (!$channel.Done -and $channel.Pending.IsCompleted) {
          $count = $channel.Pending.GetAwaiter().GetResult()
          if ($count -eq 0) { $channel.Done = $true; continue }
          $retained = [Math]::Min($count, $StreamLimitBytes - $channel.Count)
          $channel.Sink.Write($channel.Buffer, 0, $retained)
          $channel.Count += $retained
          if ($retained -ne $count) { throw 'EVIDENCE_GPG_OUTPUT_LIMIT' }
          $channel.Pending = $channel.Source.ReadAsync($channel.Buffer, 0, $channel.Buffer.Length)
        }
      }
      if ($watch.ElapsedMilliseconds -ge $remaining -or $Lifetime.ElapsedMilliseconds -ge $TotalBudgetMilliseconds) {
        throw 'EVIDENCE_GPG_TIMEOUT'
      }
      if ($process.HasExited -and $channels[0].Done -and $channels[1].Done) { break }
      $pending = @($channels | Where-Object { !$_.Done } | ForEach-Object { $_.Pending })
      if ($pending.Count -gt 0) {
        [void][Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$pending, 20)
      } else { [void]$process.WaitForExit(20) }
    }
    if ($process.ExitCode -ne 0) { throw 'EVIDENCE_GPG_FAILED' }
    return [Text.Encoding]::UTF8.GetString($output.ToArray())
  } finally {
    $stopped = $true
    try {
      # Production invocations disable agent/dirmngr autostart: only this child is owned.
      if ($started -and !$process.HasExited) {
        $process.Kill()
        $stopped = $process.WaitForExit(2000)
      }
    } catch { $stopped = $false }
    $process.Dispose()
    $output.Dispose()
    if ($null -ne $errors) { $errors.Dispose() }
    if (!$stopped) { throw 'EVIDENCE_GPG_STOP_UNVERIFIED' }
  }
}

function Confirm-EvidencePublicKey {
  param([string]$Listing, [string]$ExpectedFingerprint)

  $primaryCount = 0
  $primaryFingerprint = $null
  $awaitingFingerprint = $false
  $primary = $null
  $encryptionKeys = [Collections.Generic.List[object]]::new()
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  foreach ($line in ($Listing -split '\r?\n')) {
    $fields = $line.Split(':')
    if ($fields[0] -cin @('sec', 'ssb')) { throw 'EVIDENCE_KEY_INVALID' }
    if ($fields[0] -cin @('pub', 'sub')) {
      if ($fields.Length -lt 17 -or $fields[2] -cnotmatch '^[0-9]{1,5}$') { throw 'EVIDENCE_KEY_INVALID' }
      if ($fields[11] -cmatch 'e') { $encryptionKeys.Add($fields) }
    }
    if ($fields[0] -ceq 'pub') {
      if ($fields.Length -lt 12) { throw 'EVIDENCE_KEY_INVALID' }
      $primaryCount++
      $primary = $fields
      $awaitingFingerprint = $true
    } elseif ($fields[0] -ceq 'fpr' -and $awaitingFingerprint) {
      if ($fields.Length -lt 10 -or $fields[9] -cnotmatch '^(?:[0-9A-F]{40}|[0-9A-F]{64})$') {
        throw 'EVIDENCE_KEY_INVALID'
      }
      $primaryFingerprint = $fields[9]
      $awaitingFingerprint = $false
    } elseif ($fields[0] -cin @('sub', 'uid', 'uat') -and $awaitingFingerprint) {
      throw 'EVIDENCE_KEY_INVALID'
    }
  }
  # GPG DETAILS colon fields (one-based): 3 bits, 4 algorithm, 6/7 lifetime,
  # 10 fingerprint on fpr, 12 capabilities, 17 curve. Lowercase e is this
  # key's encryption usage; uppercase E is GPG's usable aggregate capability.
  if ($primaryCount -ne 1 -or $awaitingFingerprint -or
      $primaryFingerprint -cne $ExpectedFingerprint -or
      $primary[1] -cmatch '[iredw]' -or $primary[11] -cmatch 'D' -or
      $primary[11] -cnotmatch 'E' -or $primary[5] -cnotmatch '^[0-9]{1,12}$' -or
      [long]$primary[5] -gt $now -or
      ($primary[6] -ne '' -and ($primary[6] -cnotmatch '^[0-9]{1,12}$' -or
        ([long]$primary[6] -ne 0 -and [long]$primary[6] -le $now)))) {
    throw 'EVIDENCE_KEY_INVALID'
  }
  $rsa = $primary[3] -ceq '1' -and [int]$primary[2] -ge 3072
  $ed25519 = $primary[3] -ceq '22' -and $primary[2] -ceq '255' -and $primary[16] -ceq 'ed25519'
  if ((!$rsa -and !$ed25519) -or $primary[11] -cnotmatch 'c' -or $encryptionKeys.Count -eq 0) {
    throw 'EVIDENCE_KEY_INVALID'
  }
  foreach ($key in $encryptionKeys) {
    $approvedRsa = $rsa -and $key[3] -cin @('1', '2') -and [int]$key[2] -ge 3072
    $approvedCurve = $ed25519 -and $key[0] -ceq 'sub' -and $key[3] -ceq '18' -and
      $key[2] -ceq '255' -and $key[16] -ceq 'cv25519'
    if (!$approvedRsa -and !$approvedCurve) { throw 'EVIDENCE_KEY_INVALID' }
  }
  # No algorithm fallback: even old encryption subkeys must meet this profile.
  # GPG additionally verifies self-signatures and selects a usable bound subkey.
}

function Invoke-EvidenceEncryption {
  param([string]$ArchivePath, [string]$OutputPath, [string]$PublicKeyPath,
    [string]$ExpectedFingerprint, [string]$WorkRoot, [string]$GpgPath)

  $ErrorActionPreference = 'Stop'
  $lifetime = [Diagnostics.Stopwatch]::StartNew()
  $failureCode = 'EVIDENCE_INPUT_INVALID'
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or !$IsWindows) { throw 'EVIDENCE_PLATFORM_UNSUPPORTED' }
    if ($ExpectedFingerprint -cnotmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') {
      throw 'EVIDENCE_KEY_INVALID'
    }
    $fingerprint = $ExpectedFingerprint.ToUpperInvariant()
    foreach ($path in @($ArchivePath, $OutputPath, $PublicKeyPath, $WorkRoot)) {
      if ([string]::IsNullOrWhiteSpace($path) -or ![IO.Path]::IsPathFullyQualified($path)) {
        throw 'EVIDENCE_INPUT_INVALID'
      }
    }
    foreach ($path in @($ArchivePath, $PublicKeyPath)) {
      $item = Get-Item -LiteralPath $path -Force
      if ($item -isnot [IO.FileInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'EVIDENCE_INPUT_INVALID'
      }
    }
    foreach ($path in @($WorkRoot, [IO.Path]::GetDirectoryName($OutputPath))) {
      $item = Get-Item -LiteralPath $path -Force
      if ($item -isnot [IO.DirectoryInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'EVIDENCE_INPUT_INVALID'
      }
    }
    if (Test-Path -LiteralPath $OutputPath) { throw 'EVIDENCE_OUTPUT_EXISTS' }

    $failureCode = 'EVIDENCE_KEY_INVALID'
    $keyLimit = 256KB
    $keyStream = [IO.File]::Open($PublicKeyPath, 'Open', 'Read', 'Read')
    try {
      if ($keyStream.Length -le 0 -or $keyStream.Length -gt $keyLimit) { throw 'EVIDENCE_KEY_INVALID' }
      $keyBytes = [byte[]]::new([int]$keyStream.Length)
      $offset = 0
      while ($offset -lt $keyBytes.Length) {
        $read = $keyStream.Read($keyBytes, $offset, $keyBytes.Length - $offset)
        if ($read -eq 0) { throw 'EVIDENCE_KEY_INVALID' }
        $offset += $read
      }
    } finally { $keyStream.Dispose() }
    $armor = [Text.Encoding]::ASCII.GetString($keyBytes)
    if (@($keyBytes | Where-Object { $_ -gt 127 }).Count -gt 0 -or
        $armor -cnotmatch '\A-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n[\x09\x0a\x0d\x20-\x7e]+\r?\n-----END PGP PUBLIC KEY BLOCK-----(?:\r?\n)?\z' -or
        [regex]::Matches($armor, '-----BEGIN ').Count -ne 1 -or
        [regex]::Matches($armor, '-----END ').Count -ne 1) { throw 'EVIDENCE_KEY_INVALID' }

    $failureCode = 'EVIDENCE_GPG_UNAVAILABLE'
    if ([string]::IsNullOrEmpty($GpgPath)) {
      $git = (Get-Command git.exe -CommandType Application -ErrorAction Stop).Source
      $gitDirectory = [IO.Path]::GetDirectoryName($git)
      foreach ($relative in @('../usr/bin/gpg.exe', '../../usr/bin/gpg.exe')) {
        $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($gitDirectory, $relative))
        if ([IO.File]::Exists($candidate)) { $GpgPath = $candidate; break }
      }
    }
    if (![IO.Path]::IsPathFullyQualified($GpgPath) -or ![IO.File]::Exists($GpgPath)) {
      throw 'EVIDENCE_GPG_UNAVAILABLE'
    }
    $failureCode = 'EVIDENCE_ENCRYPTION_FAILED'
    # WorkRoot is unique per attempt; refusing an existing child prevents reuse.
    # Keep the child short for MSYS GPG's socket-path limit even with no autostart.
    $runPath = Join-Path $WorkRoot 'openpgp'
    [void](New-Item -ItemType Directory -Path $runPath)
    $homePath = $runPath
    $keyPath = Join-Path $runPath 'recipient.asc'
    [IO.File]::WriteAllBytes($keyPath, $keyBytes)
    $common = @('--no-options', '--homedir', (ConvertTo-EvidenceGpgPath $homePath), '--no-keyring', '--batch', '--no-tty', '--no-autostart',
      '--disable-dirmngr', '--no-auto-key-retrieve', '--auto-key-locate', 'clear', '--no-auto-check-trustdb')
    $listingOptions = @('--with-colons', '--fixed-list-mode', '--with-fingerprint', '--with-subkey-fingerprint')
    $invoke = @{ Executable = $GpgPath; HomePath = $homePath; Lifetime = $lifetime }
    $listing = Invoke-EvidenceGpgProcess @invoke -Arguments ($common + $listingOptions + @('--show-keys', '--', (ConvertTo-EvidenceGpgPath $keyPath))) `
      -ErrorPath (Join-Path $runPath 'inspect.stderr.private.log')
    Confirm-EvidencePublicKey $listing $fingerprint
    # Same-directory publication is an atomic, no-overwrite rename. No plaintext fallback.
    $partialPath = Join-Path ([IO.Path]::GetDirectoryName($OutputPath)) ('evidence-' + [Guid]::NewGuid().ToString('N') + '.partial')
    # Standard recipient-file avoids importing keys or probing an agent at all.
    # Its trust assumption is satisfied by the single-key/full-fingerprint check.
    # RFC4880 SEIPD/MDC is standard OpenPGP; the payload cipher is explicitly AES256.
    $status = Invoke-EvidenceGpgProcess @invoke -Arguments ($common + @(
      '--rfc4880', '--cipher-algo', 'AES256', '--compress-algo', 'none', '--force-mdc',
      '--set-filename', '', '--status-fd', '1', '--output', (ConvertTo-EvidenceGpgPath $partialPath),
      '--recipient-file', (ConvertTo-EvidenceGpgPath $keyPath), '--encrypt', '--', (ConvertTo-EvidenceGpgPath $ArchivePath))) `
      -ErrorPath (Join-Path $runPath 'encrypt.stderr.private.log') -TimeoutMilliseconds 90000
    $ciphertext = Get-Item -LiteralPath $partialPath -Force
    if ($ciphertext -isnot [IO.FileInfo] -or $ciphertext.Length -le 0 -or
        ($ciphertext.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $status -cnotmatch '(?m)^\[GNUPG:\] BEGIN_ENCRYPTION 2 9\r?$' -or
        $status -cnotmatch '(?m)^\[GNUPG:\] END_ENCRYPTION\r?$') { throw 'EVIDENCE_OUTPUT_INVALID' }
    if (Test-Path -LiteralPath $OutputPath) { throw 'EVIDENCE_OUTPUT_EXISTS' }
    [IO.File]::Move($partialPath, $OutputPath, $false)
    return [pscustomobject]@{ Status = 'encrypted'; Format = 'OpenPGP'; Cipher = 'AES256' }
  } catch {
    $closedCodes = @('EVIDENCE_PLATFORM_UNSUPPORTED', 'EVIDENCE_INPUT_INVALID', 'EVIDENCE_KEY_INVALID',
      'EVIDENCE_GPG_UNAVAILABLE', 'EVIDENCE_GPG_FAILED', 'EVIDENCE_GPG_TIMEOUT', 'EVIDENCE_GPG_OUTPUT_LIMIT',
      'EVIDENCE_GPG_STOP_UNVERIFIED', 'EVIDENCE_OUTPUT_EXISTS', 'EVIDENCE_OUTPUT_INVALID')
    if ($_.Exception.Message -cin $closedCodes) { $failureCode = $_.Exception.Message }
    throw [InvalidOperationException]::new($failureCode)
  }
}
