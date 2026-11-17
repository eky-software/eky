using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

// Causal test sequencing only. It owns no process tree and issues no runtime authority.
internal sealed class RetirementRaceContract(SourceHandoffContext source, Stopwatch clock)
{
    private const int MaximumMarkerBytes = 4096;
    private readonly ManualResetEventSlim publicationRelease = new(false);
    private readonly object causalGate = new();
    private Func<bool>? admissionOpen;
    private int admissionClosing, preconditionReady;
    private bool readyBeforeAdmissionClose;
    private long preconditionAtMs = -1;
    private SourceAdmissionFiles? files;
    private Exception? firstFailure, cleanupFailure;
    private int flushObserved, deliveryObserved, retirementObserved, unwindRelease, windowTimedOut;
    private long flushAtMs = -1, deliveredAtMs = -1, retiredAtMs = -1, windowDeadlineMs = -1, windowReturnedAtMs = -1;
    private int remainingCleanupAtEntry;
    private bool prepared, retiredMarkerPublished, workerBusy, workerConsumed, workerContinued, resourcesReleased;
    private bool eventsClosed;
    private string? originalFailureCode;
    private string ControlsRoot => Path.Combine(source.Request.WorkingDirectory, source.Request.RunNonce);
    internal string Kind => source.Proof.RaceKind ?? throw new InvalidDataException("raceKindMissing");
    internal Task Preparation { get; private set; } = Task.CompletedTask;
    internal Task HookWork { get; private set; } = Task.CompletedTask;
    internal Task PreconditionWork { get; private set; } = Task.CompletedTask;
    internal bool Prepared => prepared;
    internal bool ResourcesClosed => resourcesReleased && eventsClosed && cleanupFailure is null && (files?.AllHandlesClosed ?? true);

    internal void Prepare()
    {
        Preparation = Task.Run(() =>
        {
            try
            {
                if (Kind is not ("duringPublication" or "afterDelivery")) throw new InvalidDataException("raceKindInvalid");
                if (clock.ElapsedMilliseconds >= source.Request.TimeoutMilliseconds - source.Request.CleanupReserveMilliseconds)
                    throw new TimeoutException("racePreparationDeadline");
                files = SourceAdmissionFiles.OpenRoot(source.Request.WorkingDirectory);
                if (!CreateDirectory(SourceAdmissionFiles.NativePath(ControlsRoot), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                files.PinChildDirectory(ControlsRoot);
                files.VerifyAll();
                prepared = true;
            }
            catch (Exception error) { RecordHookFailure(error); }
        });
    }

    internal void AfterResultFlush()
    {
        Interlocked.Exchange(ref flushObserved, 1);
        Interlocked.CompareExchange(ref flushAtMs, clock.ElapsedMilliseconds, -1);
        if (Kind == "duringPublication") publicationRelease.Wait();
    }

    internal void AfterDelivery()
    {
        // No I/O, wait, or callback settlement on the real delivery assignment.
        Interlocked.CompareExchange(ref deliveredAtMs, clock.ElapsedMilliseconds, -1);
        Interlocked.Exchange(ref deliveryObserved, 1);
    }

    internal void StartPrecondition(Func<bool> isAdmissionOpen)
    {
        admissionOpen = isAdmissionOpen;
        PreconditionWork = Task.Run(() =>
        {
            try
            {
                for (;;)
                {
                    PreconditionActive();
                    var ready = Kind == "duringPublication"
                        ? Volatile.Read(ref flushObserved) != 0 && ReadMarker("worker-busy", precondition: true)
                        : Volatile.Read(ref deliveryObserved) != 0 && ReadMarker("worker-consumed", precondition: true);
                    if (ready)
                    {
                        lock (causalGate)
                        {
                            PreconditionActive();
                            if (Kind == "duringPublication") workerBusy = true;
                            else workerConsumed = true;
                            preconditionAtMs = clock.ElapsedMilliseconds;
                            Volatile.Write(ref preconditionReady, 1);
                        }
                        return;
                    }
                    Thread.Sleep((int)Math.Clamp(source.Request.TimeoutMilliseconds - source.Request.CleanupReserveMilliseconds -
                        clock.ElapsedMilliseconds, 1, 20));
                }
            }
            catch (Exception error) { RecordHookFailure(error); }
        });
    }

    private void PreconditionActive()
    {
        if (Volatile.Read(ref admissionClosing) != 0 || admissionOpen?.Invoke() != true)
            throw new OperationCanceledException("raceAdmissionRetired");
        if (clock.ElapsedMilliseconds >= source.Request.TimeoutMilliseconds - source.Request.CleanupReserveMilliseconds)
            throw new TimeoutException("racePreconditionDeadline");
    }

    internal void BeforeAdmissionClose()
    {
        lock (causalGate)
        {
            readyBeforeAdmissionClose = Volatile.Read(ref preconditionReady) != 0;
            Volatile.Write(ref admissionClosing, 1);
        }
    }

    internal void AfterRetirement(string failureCode, long elapsedMilliseconds)
    {
        if (Interlocked.Exchange(ref retirementObserved, 1) != 0) return;
        originalFailureCode = failureCode;
        retiredAtMs = elapsedMilliseconds;
        remainingCleanupAtEntry = (int)Math.Min(source.Request.CleanupReserveMilliseconds,
            Math.Max(0, source.Request.TimeoutMilliseconds - elapsedMilliseconds));
        windowDeadlineMs = elapsedMilliseconds + remainingCleanupAtEntry / 2;
        try
        {
            if (!PreconditionWork.IsCompletedSuccessfully || Volatile.Read(ref preconditionReady) == 0 ||
                !readyBeforeAdmissionClose || admissionOpen?.Invoke() != false)
            {
                RecordHookFailure(new InvalidDataException("racePreconditionNotProvedBeforeRetirement"));
                return;
            }
            HookWork = Task.Run(RunWindow);
            if (!new StopwatchSupervisorDeadline(clock).WaitForTask(HookWork, windowDeadlineMs))
            {
                Interlocked.Exchange(ref windowTimedOut, 1);
                RecordHookFailure(new TimeoutException("raceCleanupWindowDeadline"));
            }
        }
        catch (Exception error) { RecordHookFailure(error); }
        finally { ReleasePublication(); windowReturnedAtMs = clock.ElapsedMilliseconds; }
    }

    private void RunWindow()
    {
        try
        {
            WindowActive();
            WriteRetired();
            ReleasePublication();
            for (;;)
            {
                WindowActive();
                if (Kind == "duringPublication" && !workerBusy) workerBusy = ReadMarker("worker-busy");
                if (!workerConsumed) workerConsumed = ReadMarker("worker-consumed");
                if (workerConsumed && (Kind != "duringPublication" || workerBusy) && ReadMarker("worker-continued"))
                {
                    WindowActive();
                    workerContinued = true;
                    return;
                }
                Thread.Sleep((int)Math.Clamp(windowDeadlineMs - clock.ElapsedMilliseconds, 1, 20));
            }
        }
        catch (Exception error) { RecordHookFailure(error); }
        finally { ReleasePublication(); }
    }

    private void WindowActive()
    {
        if (clock.ElapsedMilliseconds >= windowDeadlineMs || Volatile.Read(ref windowTimedOut) != 0)
            throw new TimeoutException("raceCleanupWindowDeadline");
    }

    private void WriteRetired()
    {
        var scope = files ?? throw new InvalidDataException("raceControlsMissing");
        scope.VerifyAll();
        WindowActive();
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        { schemaVersion = 1, binding = source.Binding(), raceKind = Kind, @event = "native-retired" }) + "\n");
        if (bytes.Length > MaximumMarkerBytes) throw new InvalidDataException("raceMarkerSize");
        FileStream? output = null;
        Exception? primary = null;
        try
        {
            output = new FileStream(Path.Combine(ControlsRoot, "native-retired.private.json"), FileMode.CreateNew,
                FileAccess.Write, FileShare.None);
            output.Write(bytes);
            output.Flush(true);
            WindowActive();
        }
        catch (Exception error) { primary = error; RecordHookFailure(error); }
        try { output?.Dispose(); }
        catch (Exception error)
        {
            RecordCleanupFailure(error);
            if (primary is null) throw;
            throw new AggregateException(primary, error);
        }
        if (primary is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(primary).Throw();
        if (!ReadMarker("native-retired")) throw new InvalidDataException("raceRetiredMarkerMissing");
        retiredMarkerPublished = true;
    }

    private bool ReadMarker(string name, bool precondition = false)
    {
        void Active() { if (precondition) PreconditionActive(); else WindowActive(); }
        Active();
        var scope = files ?? throw new InvalidDataException("raceControlsMissing");
        scope.VerifyAll();
        var path = Path.Combine(ControlsRoot, name + ".private.json");
        var probe = CreateFile(SourceAdmissionFiles.NativePath(path), 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
        if (probe.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            try { probe.Dispose(); } catch (Exception cleanup) { RecordCleanupFailure(cleanup); throw; }
            if (error is 2 or 32) return false;
            throw new Win32Exception(error);
        }
        try
        {
            // Only the failed initial probe above is readiness. Existing-pin and target failures are fatal.
            var bytes = scope.ReadPinnedJson(path, MaximumMarkerBytes);
            Active();
            if (bytes[^1] != 10) throw new InvalidDataException("raceMarkerFrame");
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
            var row = document.RootElement;
            Exact(row, ["schemaVersion", "binding", "raceKind", "event"]);
            if (row.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
                !row.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1 ||
                row.GetProperty("raceKind").ValueKind != JsonValueKind.String || row.GetProperty("raceKind").GetString() != Kind ||
                row.GetProperty("event").ValueKind != JsonValueKind.String || row.GetProperty("event").GetString() != name)
                throw new InvalidDataException("raceMarkerSchema");
            var binding = row.GetProperty("binding");
            var expected = source.Binding();
            Exact(binding, expected.Keys.ToArray());
            if (expected.Any(entry => binding.GetProperty(entry.Key).ValueKind != JsonValueKind.String ||
                binding.GetProperty(entry.Key).GetString() != entry.Value)) throw new InvalidDataException("raceMarkerBinding");
            scope.VerifyAll();
            Active();
        }
        catch (Exception primary)
        {
            SourceHandoffPrototype.CloseFailedMailboxOpen(primary, probe, RecordHookFailure, RecordCleanupFailure);
            throw;
        }
        try { probe.Dispose(); } catch (Exception cleanup) { RecordCleanupFailure(cleanup); throw; }
        return true;
    }

    private static void Exact(JsonElement row, IReadOnlyCollection<string> expected)
    {
        if (row.ValueKind != JsonValueKind.Object) throw new InvalidDataException("raceMarkerObject");
        var keys = row.EnumerateObject().Select(property => property.Name).ToArray();
        if (keys.Length != expected.Count || keys.Distinct(StringComparer.Ordinal).Count() != keys.Length ||
            keys.Any(key => !expected.Contains(key))) throw new InvalidDataException("raceMarkerKeys");
    }

    internal void ReleasePublication() { if (!eventsClosed) publicationRelease.Set(); }
    internal void ReleaseOnUnwind()
    {
        if (eventsClosed) return;
        if (!publicationRelease.IsSet) Interlocked.Exchange(ref unwindRelease, 1);
        publicationRelease.Set();
    }
    internal void RecordHookFailure(Exception error)
    {
        if (Interlocked.CompareExchange(ref firstFailure, error, null) is null) source.Proof.ObserveFirst(error);
    }
    private void RecordCleanupFailure(Exception error)
    {
        Interlocked.CompareExchange(ref cleanupFailure, error, null);
        source.Proof.ObserveCleanup(error);
    }
    internal void Close()
    {
        if (!Preparation.IsCompleted || !PreconditionWork.IsCompleted || !HookWork.IsCompleted)
            throw new InvalidOperationException("raceWorkStillPending");
        try { files?.Dispose(); } catch (Exception error) { RecordCleanupFailure(error); }
        try { publicationRelease.Dispose(); eventsClosed = true; } catch (Exception error) { RecordCleanupFailure(error); }
        resourcesReleased = true;
    }
    internal object Snapshot() => new
    {
        schemaVersion = 1, raceKind = Kind, prepared,
        flushObserved = Volatile.Read(ref flushObserved) != 0, flushAtMs,
        deliveryObserved = Volatile.Read(ref deliveryObserved) != 0, deliveredAtMs,
        preconditionReady = Volatile.Read(ref preconditionReady) != 0, preconditionAtMs,
        admissionCloseObserved = Volatile.Read(ref admissionClosing) != 0, readyBeforeAdmissionClose,
        retirementObserved = Volatile.Read(ref retirementObserved) != 0, retiredAtMs, originalFailureCode,
        remainingCleanupAtEntry, windowDeadlineMs, windowReturnedAtMs,
        windowTimedOut = Volatile.Read(ref windowTimedOut) != 0,
        retiredMarkerPublished, workerBusy, workerConsumed, workerContinued,
        unwindRelease = Volatile.Read(ref unwindRelease) != 0,
        preparationSettled = Preparation.IsCompletedSuccessfully, preconditionWorkSettled = PreconditionWork.IsCompletedSuccessfully,
        hookWorkSettled = HookWork.IsCompletedSuccessfully,
        resourcesReleased, controlHandlesClosed = resourcesReleased && cleanupFailure is null && (files?.AllHandlesClosed ?? true), eventsClosed,
        firstFailure = Describe(Volatile.Read(ref firstFailure)), cleanupFailure = Describe(Volatile.Read(ref cleanupFailure)),
        markerBinding = source.Binding(), optionalMsiObserver = "none", productionAuthorityProved = false,
    };
    private static object? Describe(Exception? error) => error is null ? null : new
    { type = error.GetType().Name, error.HResult, nativeError = (error as Win32Exception)?.NativeErrorCode };
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectory(string path, IntPtr security);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
}
