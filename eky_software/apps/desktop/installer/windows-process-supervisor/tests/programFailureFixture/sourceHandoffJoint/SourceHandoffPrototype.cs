using System.Collections;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed record SourceBridgeProtocol(int SchemaVersion, string Operation, string RequestFile,
    string ResultFile, string ControlAckFile, int RequestMaxBytes, int ResultMaxBytes,
    IReadOnlyList<string> BindingKeys, IReadOnlyList<string> Cases)
{
    internal static SourceBridgeProtocol Read()
    {
        using var stream = typeof(SourceBridgeProtocol).Assembly.GetManifestResourceStream("bridge-protocol.private.json")
            ?? throw new InvalidDataException("sourceLaunchRequestInvalid");
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        string Text(string key) => root.GetProperty(key).GetString() ?? throw new InvalidDataException();
        IReadOnlyList<string> Strings(string key) => Array.AsReadOnly(root.GetProperty(key).EnumerateArray()
            .Select(item => item.GetString() ?? throw new InvalidDataException()).ToArray());
        return new(root.GetProperty("schemaVersion").GetInt32(), Text("operation"), Text("requestFile"),
            Text("resultFile"), Text("controlAckFile"), root.GetProperty("requestMaxBytes").GetInt32(),
            root.GetProperty("resultMaxBytes").GetInt32(), Strings("bindingKeys"), Strings("cases"));
    }
}

// Created only from the current command owner's successful, retained admission.
// The executor remains a fixed synthetic fixture; this is not source-EKY wiring.
internal sealed record SourceHandoffContext(SourceBridgeProtocol Protocol, string Case,
    SupervisorRequest Request, string FixturePath, IReadOnlyDictionary<string, string> Environment,
    WorkspaceSourceAdmission Admission, IReadOnlyList<string> SourceArguments, SourceAdmissionExperiment Proof)
{
    internal static SourceHandoffContext Create(SourceBridgeProtocol protocol, SourceAdmissionExperiment proof,
        SupervisorRequest request, WorkspaceSourceAdmission admission, string fixturePath)
    {
        var selectedCase = proof.Case;
        if (!protocol.Cases.Contains(selectedCase, StringComparer.Ordinal) ||
            !string.Equals(Path.GetFileName(request.Command), "node.exe", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetDirectoryName(request.RequestPath), admission.MailboxRoot, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(request.WorkingDirectory, admission.MailboxRoot, StringComparison.OrdinalIgnoreCase) ||
            request.RunNonce != admission.Anchors.ScenarioNonce || request.Scenario != admission.Anchors.Scenario ||
            request.ArtifactDescriptorSha256 != admission.Anchors.Descriptor || !proof.MetadataValidated ||
            !proof.Published || proof.Consumed != 1 || admission.AllHandlesClosed)
            throw new SupervisorFailure("processStateInvalid");
        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        // Exact current workspaceSuccessApplicationEnvironment filtering; never serialize this snapshot.
        foreach (DictionaryEntry entry in System.Environment.GetEnvironmentVariables())
        {
            var key = (string)entry.Key;
            if (key.Equals("ELECTRON_RUN_AS_NODE", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("EKY_", StringComparison.OrdinalIgnoreCase) ||
                key.Equals("TEMP", StringComparison.OrdinalIgnoreCase) || key.Equals("TMP", StringComparison.OrdinalIgnoreCase))
                continue;
            environment[key] = (string)entry.Value!;
        }
        environment["TEMP"] = admission.TemporaryRoot;
        environment["TMP"] = admission.TemporaryRoot;
        environment[admission.TokenEnvironment] = request.RunNonce;
        return new(protocol, selectedCase, request, Path.GetFullPath(fixturePath),
            new ReadOnlyDictionary<string, string>(environment), admission,
            Array.AsReadOnly(new[] { "--" + admission.ProofSwitch, "--user-data-dir=" + admission.UserDataPath }), proof);
    }

    internal Dictionary<string, string> Binding() => Protocol.BindingKeys.ToDictionary(key => key, key => key switch
    {
        "runNonce" => Request.RunNonce,
        "scenario" => Request.Scenario,
        "artifactDescriptorSha256" => Request.ArtifactDescriptorSha256,
        "buildRevision" => Admission.Anchors.Build,
        "scenarioRoot" => Admission.WorkingDirectory,
        _ => throw new InvalidDataException("sourceLaunchRequestInvalid"),
    }, StringComparer.Ordinal);
}

// One closed operation borrowing the existing owner's Job and deadline. No polling thread or timer.
internal sealed class SourceHandoffPrototype(SourceHandoffContext context, WindowsJob job, Func<long> elapsed)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly CancellationTokenSource cancellation = new();
    private Task<MailboxLease.RootPin?>? rootAdmission;
    private MailboxLease.RootPin? rootPin;
    private SourceRequestFailure? requestFailure;
    private Task<MailboxRead>? read;
    private Task<SuspendedWindowsProcess>? creation;
    private Task? publication;
    private Task<bool>? inspection;
    private Task? acknowledgement;
    private MailboxLease? lease;
    private SuspendedWindowsProcess? child;
    private bool consumed;
    private bool delivered;
    private volatile bool closed;
    private bool handlesClosed;
    private bool cancellationDisposed;
    internal bool ReleaseFailed { get; private set; }
    private int releaseAttempts;
    internal int CreationAttempts { get; private set; }
    internal bool RequestRejected { get; private set; }
    internal bool ReplayRejected { get; private set; }
    internal bool SourceExited { get; private set; }
    internal int? SourceExitCode { get; private set; }
    internal bool BirthCapturedBeforeResume { get; private set; }
    internal bool SourceInSameJobBeforeResume { get; private set; }
    internal string? SourceErrorCode { get; private set; }
    private long? birthObservedAtMs, resumeStartedAtMs, resumeReturnedAtMs;
    private long? lastLiveQueryStartedAtMs, lastLiveQueryReturnedAtMs, exitQueryStartedAtMs, exitQueryReturnedAtMs;
    internal bool RequiredWorkSettled => rootAdmission is null && read is null && creation is null && publication is null &&
        inspection is null && acknowledgement is null;
    internal bool CreationSettled => creation is null;
    internal bool SourceSignalled => child is null || child.Wait(0);
    internal bool SourceHandlesClosed => child is null ? CreationAttempts == 0 || handlesClosed : child.HandlesClosed;
    private string RequestPath => Path.Combine(context.Request.WorkingDirectory, context.Protocol.RequestFile);

    internal bool RootAdmitted => rootPin is not null;
    internal bool AdmissionClosed => closed;

    internal Task BeginRootAdmission()
    {
        rootAdmission = Task.Run<MailboxLease.RootPin?>(() =>
        {
            var stage = "rootOpen";
            context.Admission.Verify();
            try { return MailboxLease.RootPin.Open(context.Request.WorkingDirectory, value => stage = value); }
            catch (Exception error) { RecordRequestFailure(stage, error); return null; }
        });
        return rootAdmission;
    }

    internal void SettleRootAdmission()
    {
        if (rootAdmission is not { IsCompleted: true }) return;
        var task = rootAdmission;
        rootAdmission = null;
        try { rootPin = task.GetAwaiter().GetResult(); }
        catch (Exception error) { RecordRequestFailure("rootAdmission", error); }
        if (rootPin is null)
        {
            RequestRejected = true;
            Fail("sourceLaunchRequestInvalid");
        }
    }

    internal void Poll(Func<bool> mayResume)
    {
        SettleRootAdmission();
        if (read is { IsCompleted: true })
        {
            var task = read;
            read = null;
            MailboxRead value;
            try { value = task.GetAwaiter().GetResult(); }
            catch (Exception error) { RecordRequestFailure("requestTask", error); value = new(true, null, false); }
            if (closed) value.Lease?.Dispose();
            else if (value.Observed)
            {
                consumed = true;
                lease = value.Lease;
                if (!value.Valid)
                {
                    RequestRejected = true;
                    Fail("sourceLaunchRequestInvalid");
                    Publish(null, SourceErrorCode);
                }
                else
                {
                    if (!mayResume()) CloseAdmission();
                    else
                    {
                        CreationAttempts++;
                        creation = Task.Run(() =>
                        {
                            if (context.Case == "heldCreation")
                            {
                                context.Proof.SourceCreationHeld.Set();
                                context.Proof.SourceCreationRelease.Wait();
                            }
                            return SuspendedWindowsProcess.StartSyntheticSource(context, job, cancellation.Token);
                        });
                    }
                }
            }
        }
        if (creation is { IsCompleted: true })
        {
            var task = creation;
            creation = null;
            try
            {
                child = task.GetAwaiter().GetResult();
                // The creation handle already exists. Never reopen this process by PID.
                BirthCapturedBeforeResume = context.Case != "birthRejected" && child.CaptureSourceBirth();
                SourceInSameJobBeforeResume = job.ContainsProcess(child.Process);
                if (BirthCapturedBeforeResume) birthObservedAtMs = elapsed();
                if (!closed && SourceErrorCode is null && BirthCapturedBeforeResume && SourceInSameJobBeforeResume && mayResume())
                {
                    resumeStartedAtMs = elapsed();
                    child.Resume();
                    resumeReturnedAtMs = elapsed();
                }
                else if (!closed)
                {
                    Fail("ownedProcessStartFailed");
                    Publish(null, SourceErrorCode);
                }
            }
            catch (Exception error)
            {
                RecordRequestFailure("sourceCreation", error);
                Fail("ownedProcessStartFailed");
                if (!closed) Publish(null, SourceErrorCode);
            }
        }
        if (!closed && child is not null && !SourceExited && publication is null && !delivered &&
            SourceErrorCode is null)
        {
            try
            {
                var queryStarted = elapsed();
                var signalled = child.Wait(0);
                var queryReturned = elapsed();
                if (signalled)
                {
                    exitQueryStartedAtMs = queryStarted;
                    exitQueryReturnedAtMs = queryReturned;
                    SourceExitCode = child.GetSourceExitCode();
                    SourceExited = true;
                    Publish(SourceExitCode, null);
                }
                else { lastLiveQueryStartedAtMs = queryStarted; lastLiveQueryReturnedAtMs = queryReturned; }
            }
            catch (Exception error) { RecordRequestFailure("sourceExit", error); Fail("ownedProcessExitInvalid"); Publish(null, SourceErrorCode); }
        }
        if (publication is { IsCompleted: true })
        {
            var task = publication;
            publication = null;
            try
            {
                task.GetAwaiter().GetResult(); AssertPublicationActive(); delivered = true;
                context.Proof.RetirementRace?.AfterDelivery();
            }
            catch (Exception error) { RecordRequestFailure("resultPublication", error); Fail("sourceLaunchRequestInvalid"); }
        }
        if (inspection is { IsCompleted: true })
        {
            var task = inspection;
            inspection = null;
            var valid = false;
            try { valid = task.GetAwaiter().GetResult(); }
            catch (Exception error) { RecordRequestFailure("requestInspection", error); }
            if (!valid)
            {
                ReplayRejected = true;
                RecordRequestFailure("requestReplay", null);
                Fail("sourceLaunchRequestInvalid");
                if (!closed && context.Case == "replay" && acknowledgement is null)
                    acknowledgement = Task.Run(() => PublishFile(context.Protocol.ControlAckFile,
                        new { schemaVersion = context.Protocol.SchemaVersion, replayRejected = true }));
            }
        }
        if (acknowledgement is { IsCompleted: true })
        {
            var task = acknowledgement;
            acknowledgement = null;
            try { task.GetAwaiter().GetResult(); }
            catch (Exception error) { RecordRequestFailure("ackPublication", error); Fail("sourceLaunchRequestInvalid"); }
        }
        if (closed || !RootAdmitted) return;
        if (!consumed && read is null) read = Task.Run(ReadRequest);
        if (consumed && !ReplayRejected && inspection is null)
            inspection = Task.Run(() =>
            {
                rootPin!.Verify(RequestPath);
                // .next is only the retained replay-control sentinel, not publication.
                try { _ = File.GetAttributes(RequestPath + ".next"); return false; }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { return false; }
                lease?.Verify();
                return true;
            });
    }

    private void Fail(string code) => SourceErrorCode ??= code;

    internal void CloseAdmission()
    {
        if (closed) return;
        context.Proof.RetirementRace?.BeforeAdmissionClose();
        closed = true;
        var closeRequestedAtMs = elapsed();
        try { cancellation.Cancel(); }
        finally { context.Proof.NotifySourceReservationCloseRequested(closeRequestedAtMs); }
    }

    internal void CompleteAtRootExit()
    {
        if (!consumed || !delivered) Fail("sourceLaunchRequestInvalid");
    }

    internal void ReleaseSettledHandles()
    {
        if (!RequiredWorkSettled || !SourceSignalled) return;
        ReleaseOwnedResources();
    }

    private void CloseResource(Action close, string role)
    {
        releaseAttempts++;
        try
        {
            close();
            if (context.Case is "exit7CleanupFailure" or "exit0CleanupFailure" && role == "request")
                throw new IOException("syntheticRequestLeaseCloseFailure");
        }
        catch (Exception error) { ReleaseFailed = true; context.Proof.ObserveCleanup(error); }
    }

    private void ReleaseOwnedResources()
    {
        if (child is not null) CloseResource(child.Dispose, "source");
        handlesClosed = child is null || child.HandlesClosed;
        if (lease is not null)
        {
            CloseResource(lease.Dispose, "request");
            if (lease.IsClosed) lease = null;
        }
        if (rootPin is not null)
        {
            CloseResource(rootPin.Dispose, "mailbox");
            if (rootPin.IsClosed) rootPin = null;
        }
        CloseResource(() => { cancellation.Dispose(); cancellationDisposed = true; }, "cancellation");
    }

    internal Task ReleaseLateWork() => Task.Run(async () =>
    {
        // This receives required work after the owner's reserve. It never resumes or starts another operation.
        var pendingAdmission = rootAdmission;
        if (pendingAdmission is not null)
        {
            try { rootPin = await pendingAdmission; }
            catch (Exception error) { RecordRequestFailure("rootAdmission", error); }
            rootAdmission = null;
        }
        var pendingRead = read;
        if (pendingRead is not null)
        {
            try
            {
                // A pending read has not transferred its lease into this field yet.
                lease = (await pendingRead).Lease;
            }
            catch (Exception error) { RecordRequestFailure("lateRead", error); }
            read = null;
        }
        var pendingCreation = creation;
        if (pendingCreation is not null)
        {
            try { child = await pendingCreation; }
            catch (Exception error) { RecordRequestFailure("lateCreation", error); }
            creation = null;
        }
        if (publication is not null)
        {
            // Settling retired I/O releases its resources, never delivery authority.
            try { await publication; }
            catch (Exception error) { RecordRequestFailure("lateResultPublication", error); Fail("sourceLaunchRequestInvalid"); }
        }
        if (inspection is not null)
        {
            var valid = false;
            try { valid = await inspection; }
            catch (Exception error) { RecordRequestFailure("lateRequestInspection", error); }
            if (!valid)
            {
                ReplayRejected = true;
                RecordRequestFailure("lateRequestReplay", null);
                Fail("sourceLaunchRequestInvalid");
            }
        }
        if (acknowledgement is not null)
        {
            try { await acknowledgement; }
            catch (Exception error) { RecordRequestFailure("lateAckPublication", error); Fail("sourceLaunchRequestInvalid"); }
        }
        publication = null; inspection = null; acknowledgement = null;
        ReleaseOwnedResources();
    });

    private void Publish(int? exitCode, string? error)
    {
        if (publication is not null || delivered || closed) return;
        publication = Task.Run(() =>
        {
            if (!RequestRejected) lease?.Verify();
            PublishFile(context.Protocol.ResultFile, new
            {
                schemaVersion = context.Protocol.SchemaVersion, binding = context.Binding(),
                operation = context.Protocol.Operation, status = error is null ? "completed" : "failed",
                exitCode, errorCode = error,
            });
        });
    }

    private void PublishFile(string filename, object value)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, JsonOptions) + "\n");
        if (bytes.Length > context.Protocol.ResultMaxBytes) throw new InvalidDataException();
        AssertPublicationActive();
        var path = Path.Combine(context.Request.WorkingDirectory, filename);
        var root = rootPin ?? throw new InvalidDataException();
        root.Verify(path);
        AssertPublicationActive();
        // The real evidence reservation forbids rename. Readiness requires an
        // exclusive final-name writer to close, an LF frame and an active reader.
        UsePublicationResource(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None), output =>
        {
            AssertPublicationActive();
            MailboxLease.ValidateCreated(root, path, output.SafeFileHandle);
            output.Write(bytes);
            AssertPublicationActive();
            output.Flush(true);
            if (filename == context.Protocol.ResultFile) context.Proof.RetirementRace?.AfterResultFlush();
            AssertPublicationActive();
            MailboxLease.ValidateCreated(root, path, output.SafeFileHandle);
        });
        AssertPublicationActive();
        root.Verify(path);
        AssertPublicationActive();
        UsePublicationResource(MailboxLease.Open(root, path, context.Protocol.ResultMaxBytes,
            error => RecordRequestFailure("resultPublication", error), ObserveMailboxOpenCleanup), published =>
        {
            AssertPublicationActive();
            if (!published.Bytes.AsSpan().SequenceEqual(bytes)) throw new InvalidDataException();
            root.Verify(path);
        });
        AssertPublicationActive();
    }

    private void AssertPublicationActive()
    {
        cancellation.Token.ThrowIfCancellationRequested();
        if (closed || elapsed() >= context.Request.TimeoutMilliseconds - context.Request.CleanupReserveMilliseconds)
            throw new OperationCanceledException("sourcePublicationRetired");
    }

    private void ObserveMailboxOpenCleanup(Exception error)
    {
        ReleaseFailed = true;
        context.Proof.ObserveCleanup(error);
    }

    // Keep the failed-open cause observable before an independent rollback-close failure.
    internal static void CloseFailedMailboxOpen(Exception primary, IDisposable resource,
        Action<Exception> observePrimary, Action<Exception> observeCleanup)
    {
        observePrimary(primary);
        try { resource.Dispose(); }
        catch (Exception cleanup)
        {
            observeCleanup(cleanup);
            throw new AggregateException(primary, cleanup);
        }
    }

    private void UsePublicationResource<T>(T resource, Action<T> use) where T : IDisposable
    {
        Exception? primary = null;
        try { use(resource); }
        catch (Exception error) { primary = error; RecordRequestFailure("resultPublication", error); }
        try { resource.Dispose(); }
        catch (Exception error)
        {
            ReleaseFailed = true;
            context.Proof.ObserveCleanup(error);
            if (primary is null) throw;
            throw new AggregateException(primary, error);
        }
        if (primary is not null) ExceptionDispatchInfo.Capture(primary).Throw();
    }

    private MailboxRead ReadRequest()
    {
        MailboxLease? opened = null;
        var stage = "requestRoot";
        try
        {
            var admittedRoot = rootPin ?? throw new InvalidDataException();
            admittedRoot.Verify(RequestPath, value => stage = value);
            stage = "requestPresence";
            _ = File.GetAttributes(RequestPath);
            if (context.Case == "heldRead")
            {
                context.Proof.TransportReadHeld.Set();
                context.Proof.TransportReadRelease.Wait();
            }
            cancellation.Token.ThrowIfCancellationRequested();
            context.Admission.Verify();
            stage = "requestOpen";
            opened = MailboxLease.Open(admittedRoot, RequestPath, context.Protocol.RequestMaxBytes,
                error => RecordRequestFailure(stage, error), ObserveMailboxOpenCleanup, value => stage = value);
            stage = "requestFrame";
            if (opened.Bytes[^1] != (byte)'\n') throw new InvalidDataException();
            stage = "requestJson";
            using var document = JsonDocument.Parse(opened.Bytes, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            stage = "requestSchema";
            var valid = ExactKeys(root, ["schemaVersion", "binding", "operation"]) &&
                root.GetProperty("schemaVersion").TryGetInt32(out var version) && version == context.Protocol.SchemaVersion &&
                root.GetProperty("operation").ValueKind == JsonValueKind.String &&
                root.GetProperty("operation").GetString() == context.Protocol.Operation;
            if (valid)
            {
                stage = "requestBinding";
                var binding = root.GetProperty("binding");
                valid = ExactKeys(binding, context.Protocol.BindingKeys) && context.Binding().All(entry =>
                    binding.GetProperty(entry.Key).ValueKind == JsonValueKind.String &&
                    binding.GetProperty(entry.Key).GetString() == entry.Value);
            }
            if (!valid) RecordRequestFailure(stage, null);
            opened.Verify(value => stage = value);
            return new(true, opened, valid);
        }
        catch (FileNotFoundException) when (opened is null && (stage is "requestPresence" or "requestOpen"))
        { return new(false, null, false); }
        // Only the final-file open is readiness. Root/identity/read errors remain fatal.
        catch (Win32Exception error) when (opened is null && stage == "requestOpen" && error.NativeErrorCode == 32)
        { return new(false, null, false); }
        catch (Exception error) { RecordRequestFailure(stage, error); return new(true, opened, false); }
    }

    private static bool ExactKeys(JsonElement root, IReadOnlyList<string> expected)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject()) if (!keys.Add(property.Name)) return false;
        return keys.Count == expected.Count && expected.All(keys.Contains);
    }

    internal object Proof(SupervisorOutcome? originalOwnerOutcome = null) => new
    {
        schemaVersion = context.Protocol.SchemaVersion, @case = context.Case,
        originalOwnerOutcome,
        originalOwnerHostOperationsCompleted = originalOwnerOutcome?.HostOperationsCompleted,
        creationAttempts = CreationAttempts, requestRejected = RequestRejected, replayRejected = ReplayRejected,
        sourceExited = SourceExited, sourceExitCode = SourceExitCode,
        birthCapturedBeforeResume = BirthCapturedBeforeResume, sourceInSameJobBeforeResume = SourceInSameJobBeforeResume,
        sourceBirth = child?.SourceBirth,
        birthObservedAtMs, resumeStartedAtMs, resumeReturnedAtMs, lastLiveQueryStartedAtMs, lastLiveQueryReturnedAtMs,
        exitQueryStartedAtMs, exitQueryReturnedAtMs,
        requiredWorkSettled = RequiredWorkSettled, sourceHandlesClosed = SourceHandlesClosed, sourceErrorCode = SourceErrorCode,
        resultDeliveredBeforeRetirement = delivered,
        releaseFailed = ReleaseFailed, releaseAttempts,
        allSettledResourcesClosed = SourceHandlesClosed && (lease?.IsClosed ?? true) && (rootPin?.IsClosed ?? true) && cancellationDisposed,
        requestFailure = Volatile.Read(ref requestFailure),
    };

    private void RecordRequestFailure(string stage, Exception? error)
    {
        // Only fixed internal stages and allowlisted types; never project message, path, stack or environment.
        var type = error switch
        {
            null => "none",
            UnauthorizedAccessException => "UnauthorizedAccessException",
            FileNotFoundException => "FileNotFoundException",
            DirectoryNotFoundException => "DirectoryNotFoundException",
            EndOfStreamException => "EndOfStreamException",
            InvalidDataException => "InvalidDataException",
            IOException => "IOException",
            JsonException => "JsonException",
            Win32Exception => "Win32Exception",
            SupervisorFailure => "SupervisorFailure",
            ObjectDisposedException => "ObjectDisposedException",
            InvalidOperationException => "InvalidOperationException",
            OperationCanceledException => "OperationCanceledException",
            ArgumentException => "ArgumentException",
            _ => "Exception",
        };
        var failure = new SourceRequestFailure(stage, type, error?.HResult,
            error is Win32Exception native ? native.NativeErrorCode : (error as SupervisorFailure)?.Win32ErrorCode);
        Interlocked.CompareExchange(ref requestFailure, failure, null);
    }

    private sealed record SourceRequestFailure(
        [property: JsonPropertyName("stageCode")] string StageCode,
        [property: JsonPropertyName("exceptionType")] string ExceptionType,
        [property: JsonPropertyName("hresult")] int? HResult,
        [property: JsonPropertyName("nativeError")] int? NativeError);

    private sealed record MailboxRead(bool Observed, MailboxLease? Lease, bool Valid);

    // The exact admitted root is pinned; no metadata walk escapes into host ancestors.
    // FileShare.Read keeps each consumed file immutable until required operations settle.
    private sealed class MailboxLease : IDisposable
    {
        private readonly RootPin root;
        private readonly string path;
        private readonly FileStream stream;
        private readonly SafeFileHandle handle;
        private readonly FileInformation identity;
        internal byte[] Bytes { get; }

        private MailboxLease(RootPin root, string path, FileStream stream, FileInformation identity, byte[] bytes)
        { this.root = root; this.path = path; this.stream = stream; this.handle = stream.SafeFileHandle; this.identity = identity; Bytes = bytes; }
        internal bool IsClosed => handle.IsClosed;

        internal static void ValidateCreated(RootPin root, string path, SafeFileHandle handle)
        {
            root.Verify(path);
            _ = Information(handle, path, false, null);
            root.Verify(path);
        }

        internal static MailboxLease Open(RootPin root, string path, int maximum,
            Action<Exception> observePrimary, Action<Exception> observeCleanup, Action<string>? observe = null)
        {
            root.Verify(path, observe);
            observe?.Invoke("requestOpen");
            var handle = CreateFile(SourceAdmissionFiles.NativePath(path), 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                var error = Marshal.GetLastWin32Error();
                handle.Dispose();
                if (error == 2) throw new FileNotFoundException();
                throw new Win32Exception(error);
            }
            FileStream? stream = null;
            try
            {
                stream = new FileStream(handle, FileAccess.Read, 4096, false);
                observe?.Invoke("requestInformation");
                var identity = Information(handle, path, false, observe);
                observe?.Invoke("requestLength");
                if (stream.Length < 2 || stream.Length > maximum) throw new InvalidDataException();
                var bytes = new byte[(int)stream.Length];
                observe?.Invoke("requestRead");
                stream.ReadExactly(bytes);
                var result = new MailboxLease(root, path, stream, identity, bytes);
                result.Verify(observe);
                return result;
            }
            catch (Exception primary)
            {
                CloseFailedMailboxOpen(primary, (IDisposable?)stream ?? handle, observePrimary, observeCleanup);
                throw;
            }
        }

        internal void Verify(Action<string>? observe = null)
        {
            lock (stream)
            {
                root.Verify(path, observe);
                observe?.Invoke("requestInformation");
                var current = Information(stream.SafeFileHandle, path, false, observe);
                observe?.Invoke("requestIntegrity");
                if (!SameIdentity(current, identity) || stream.Length != Bytes.Length) throw new InvalidDataException();
                stream.Position = 0;
                var bytes = new byte[Bytes.Length];
                observe?.Invoke("requestRead");
                stream.ReadExactly(bytes);
                observe?.Invoke("requestIntegrity");
                if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes), SHA256.HashData(Bytes)) ||
                    !SameIdentity(Information(stream.SafeFileHandle, path, false, observe), identity))
                    throw new InvalidDataException();
                observe?.Invoke("requestPathOpen");
                using var other = CreateFile(SourceAdmissionFiles.NativePath(path), 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
                if (other.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                observe?.Invoke("requestPathIdentity");
                if (!SameIdentity(Information(other, path, false, observe), identity)) throw new InvalidDataException();
                root.Verify(path, observe);
            }
        }

        private static bool SameIdentity(FileInformation left, FileInformation right) =>
            SameFileId(left, right) && left.Attributes == right.Attributes &&
            left.SizeHigh == right.SizeHigh && left.SizeLow == right.SizeLow &&
            left.NumberOfLinks == right.NumberOfLinks &&
            left.CreationTime.Equals(right.CreationTime) && left.LastWriteTime.Equals(right.LastWriteTime);

        private static bool SameFileId(FileInformation left, FileInformation right) =>
            left.VolumeSerialNumber == right.VolumeSerialNumber &&
            left.IndexHigh == right.IndexHigh && left.IndexLow == right.IndexLow;

        internal sealed class RootPin : IDisposable
        {
            private const uint RootSharing = (uint)(FileShare.Read | FileShare.Write);
            private readonly string path;
            private readonly SafeFileHandle handle;
            private readonly FileInformation identity;
            internal bool IsClosed => handle.IsClosed;

            private RootPin(string path, SafeFileHandle handle, FileInformation identity)
            { this.path = path; this.handle = handle; this.identity = identity; }

            internal static RootPin Open(string admittedRoot, Action<string> observe)
            {
                var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(admittedRoot));
                observe("rootOpen");
                // Child atomic renames require write-sharing; root delete-sharing stays disabled.
                var handle = CreateFile(SourceAdmissionFiles.NativePath(path), 0x81, RootSharing, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                if (handle.IsInvalid)
                {
                    var error = Marshal.GetLastWin32Error();
                    handle.Dispose();
                    throw new Win32Exception(error);
                }
                try
                {
                    observe("rootInformation");
                    var identity = Information(handle, path, true, observe);
                    var result = new RootPin(path, handle, identity);
                    result.Verify(Path.Combine(path, "root-pin-check.private"), observe);
                    return result;
                }
                catch { handle.Dispose(); throw; }
            }

            internal void Verify(string target, Action<string>? observe = null)
            {
                observe?.Invoke("rootScope");
                if (!string.Equals(Path.GetDirectoryName(Path.GetFullPath(target)), path, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException();
                observe?.Invoke("rootHeldIdentity");
                if (!SameFileId(Information(handle, path, true, observe), identity)) throw new InvalidDataException();
                observe?.Invoke("rootPathOpen");
                using var current = CreateFile(SourceAdmissionFiles.NativePath(path), 0x81, RootSharing, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                if (current.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                observe?.Invoke("rootPathIdentity");
                if (!SameFileId(Information(current, path, true, observe), identity)) throw new InvalidDataException();
            }

            public void Dispose() => handle.Dispose();
        }

        private static FileInformation Information(SafeFileHandle handle, string expected, bool directory,
            Action<string>? observe)
        {
            if (!GetFileInformationByHandle(handle, out var value))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (directory
                ? (value.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != FileAttributes.Directory
                : value.NumberOfLinks != 1 ||
                    (value.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != 0)
                throw new InvalidDataException();
            observe?.Invoke(directory ? "rootFinalPath" : "requestFinalPath");
            var buffer = new StringBuilder(32_768);
            var length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (length >= buffer.Capacity ||
                !string.Equals(Path.TrimEndingDirectorySeparator(buffer.ToString()),
                    "\\\\?\\" + Path.TrimEndingDirectorySeparator(Path.GetFullPath(expected)), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException();
            return value;
        }

        public void Dispose() => stream.Dispose();

        [StructLayout(LayoutKind.Sequential)] private struct FileInformation
        {
            internal FileAttributes Attributes;
            internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
            internal System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
            internal System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
            internal uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
            uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
        [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
    }
}
