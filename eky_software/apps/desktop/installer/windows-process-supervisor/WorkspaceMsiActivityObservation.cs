using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal enum WorkspaceMsiMembership
{
    None, Owned, Outside, Mixed, Unknown, Limited,
}

internal sealed record MsiSourceObservationContext(Func<bool> Admitted,
    Func<MsiResourceObservation.SourceRead?> RetainSource, Func<long> ElapsedMilliseconds);

// Optional evidence only. The existing MSI count and product checks still decide readiness.
internal sealed class WorkspaceMsiActivityObservation : IDisposable
{
    internal static readonly int MaximumClients = MsiWindowObservation.Contract.MaximumClients;
    internal static readonly int MaximumSamples = MsiWindowObservation.Contract.MaximumSamples;
    private const long SampleIntervalMilliseconds = 60_000;
    private readonly WindowsJob job;
    private readonly SafeEvidenceWriter evidence;
    private readonly Func<WindowsJob, WorkspaceMsiMembership> capture;
    private readonly bool enabled;
    private Task<WorkspaceMsiMembership>? pending;
    private long nextSample;
    private int samples;
    private volatile bool stopped;
    private readonly MsiWindowEvidence? windows;
    private long observedElapsed;
    private string? windowDelivery;
    private readonly SupervisorRequest? request;
    private readonly MsiSourceObservationContext? sourceObservation;
    private bool sourceObservationArmed;
    private bool firstSourcePromptRead;
    private bool precedingSourceUiIncomplete;
    internal Task? PendingRead => pending;

    internal WorkspaceMsiActivityObservation(string scenario, WindowsJob job, SafeEvidenceWriter evidence,
        Func<WindowsJob, WorkspaceMsiMembership>? capture = null, SupervisorRequest? request = null,
        Action? beforeWindowWrite = null, MsiSourceObservationContext? sourceObservation = null)
    {
        this.job = job;
        this.evidence = evidence;
        this.capture = capture ?? Capture;
        this.request = request;
        this.sourceObservation = sourceObservation;
        enabled = scenario is "packagedWorkspaceSuccess" or "packagedWorkspaceFaultRollback";
        windows = enabled && request is not null ? new MsiWindowEvidence(request, beforeWindowWrite) : null;
    }

    internal void Poll(long elapsedMilliseconds)
    {
        if (!enabled || stopped) return;
        if (pending?.IsCompleted == true) PublishCompleted();
        if (!sourceObservationArmed && sourceObservation?.Admitted() == true)
        {
            sourceObservationArmed = true;
            nextSample = elapsedMilliseconds;
        }
        if (pending is not null || samples >= MaximumSamples || elapsedMilliseconds < nextSample) return;
        samples++;
        observedElapsed = elapsedMilliseconds;
        windowDelivery = null;
        nextSample = elapsedMilliseconds + SampleIntervalMilliseconds;
        // Never await optional OS enumeration on the terminal/cleanup path. At most one read exists.
        try { pending = Task.Run(() => stopped ? WorkspaceMsiMembership.Unknown : capture(job)); }
        catch { Publish("unavailable", "observationUnknown"); }
    }

    private void PublishCompleted()
    {
        WorkspaceMsiMembership result;
        try { result = pending!.GetAwaiter().GetResult(); }
        catch { result = WorkspaceMsiMembership.Unknown; }
        pending = null;
        var code = result switch
        {
            WorkspaceMsiMembership.None => "noneObserved",
            WorkspaceMsiMembership.Owned => "ownedObserved",
            WorkspaceMsiMembership.Outside => "outsideObserved",
            WorkspaceMsiMembership.Mixed => "mixedObserved",
            WorkspaceMsiMembership.Limited => "observationLimited",
            _ => "observationUnknown",
        };
        Publish("observed", code);
        if (windowDelivery is not null) PublishWindowDelivery(windowDelivery);
    }

    private void Publish(string status, string code)
    {
        try { evidence.Write("msiClientMembership", status, code); }
        catch { /* Optional observation must not alter the strict result or cleanup. */ }
    }

    private void PublishWindowDelivery(string status)
    {
        try { evidence.Write("msiWindowEvidence", status); }
        catch { /* Delivery evidence is optional, including during cleanup. */ }
    }

    public void Dispose()
    {
        if (stopped) return;
        stopped = true;
        if (pending is null) return;
        if (pending.IsCompleted) PublishCompleted();
        else
        {
            Publish("unavailable", "observationPending");
            if (windows is not null) PublishWindowDelivery("pending");
            // Host exit is owned by the existing outer process boundary, not by this diagnostic.
            _ = pending.ContinueWith(completed => { _ = completed.Exception; },
                CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted |
                TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }

    private WorkspaceMsiMembership Capture(WindowsJob owner)
    {
        if (stopped) return WorkspaceMsiMembership.Unknown;
        Process[] clients = [];
        SafeProcessHandle? firstInstaller = null;
        MsiSourceObservationContext? sourceContext = null;
        try
        {
            sourceContext = !firstSourcePromptRead && sourceObservation?.Admitted() == true ? sourceObservation : null;
            using var current = Process.GetCurrentProcess();
            var session = current.SessionId;
            clients = Process.GetProcessesByName("msiexec");
            if (clients.Length > MaximumClients)
            {
                MarkIncompleteSourceSweep(sourceContext);
                return WorkspaceMsiMembership.Limited;
            }
            var owned = false;
            var outside = false;
            var unknown = false;
            var windowSamples = new List<MsiWindowSample>();
            var windowBudget = Stopwatch.StartNew();
            var remainingCharacters = MsiWindowObservation.Contract.MaximumTotalCharacters;
            var remainingWindows = MsiWindowObservation.Contract.MaximumWindows;
            using var sourceRead = RetainOptionalSource(sourceContext);
            MsiSourceObservation? firstPrompt = null;
            Func<bool>? samePrompt = null;
            var singlePrompt = false;
            var sourceStateAtPrompt = "unknown";
            foreach (var client in clients)
            {
                if (stopped) return WorkspaceMsiMembership.Unknown;
                // Keep the process object held while checking image, session and live membership.
                var handle = OpenProcess(QueryLimitedInformation | Synchronize, false, (uint)client.Id);
                try
                {
                    if (handle.IsInvalid) { unknown = true; continue; }
                    var name = new StringBuilder(32_768);
                    var length = (uint)name.Capacity;
                    if (!QueryFullProcessImageName(handle, 0, name, ref length) ||
                        !ProcessIdToSessionId((uint)client.Id, out var actualSession))
                    { unknown = true; continue; }
                    if (!string.Equals(Path.GetFileName(name.ToString()), "msiexec.exe", StringComparison.OrdinalIgnoreCase))
                    { unknown = true; continue; }
                    if (actualSession != session) continue;
                    switch (ObserveHandle(owner, handle))
                    {
                        case WorkspaceMsiMembership.Owned:
                            owned = true;
                            if (windows is not null && MsiWindowObservation.IsSystemInstaller(name.ToString()))
                            {
                                var targetBound = sourceContext is not null && firstPrompt is null &&
                                    sourceRead?.IsDirectChild(handle) == true;
                                var sourceBefore = targetBound ? sourceRead?.IsLive() : null;
                                var promptStart = sourceContext?.ElapsedMilliseconds() ?? 0;
                                Func<bool>? verifyPrompt = null;
                                Action<Func<bool>>? offerPrompt = targetBound ? verify => verifyPrompt = verify : null;
                                MsiWindowSample sample;
                                try { sample = MsiWindowObservation.Capture(owner, handle, () => stopped,
                                    windowBudget, ref remainingCharacters, ref remainingWindows, offerSamePrompt: offerPrompt,
                                    requireCompleteSweep: sourceContext is not null); }
                                catch { sample = new((uint)client.Id, "unavailable", []); }
                                var promptEnd = sourceContext?.ElapsedMilliseconds() ?? 0;
                                var sourceAfter = targetBound ? sourceRead?.IsLive() : null;
                                windowSamples.Add(sample);
                                var matches = MsiWindowObservation.CountClosingPrompts(sample);
                                if (sourceContext is not null && targetBound && matches > 0)
                                {
                                    firstSourcePromptRead = true;
                                    firstPrompt = new("unknown", "unknown", promptStart, promptEnd, null, null);
                                    singlePrompt = matches == 1;
                                    if (singlePrompt && sample.Status == "observed" && verifyPrompt is not null)
                                    {
                                        firstInstaller = handle;
                                        samePrompt = verifyPrompt;
                                        sourceStateAtPrompt = MsiSourceObservation.ClassifyPromptState(sourceBefore, sourceAfter);
                                    }
                                }
                            }
                            break;
                        case WorkspaceMsiMembership.Outside: outside = true; break;
                        default: unknown = true; break;
                    }
                }
                finally { if (!ReferenceEquals(firstInstaller, handle)) handle.Dispose(); }
            }
            var windowSweepComplete = !unknown && windowSamples.All(sample => sample.Status == "observed");
            var resourceAdmitted = ResourceAdmission(() => windowBudget.ElapsedMilliseconds);
            MsiResourceSample? resources = null;
            if (firstPrompt is null)
            {
                if (sourceContext is not null && !windowSweepComplete) precedingSourceUiIncomplete = true;
                if (sourceContext is null && !firstSourcePromptRead && sourceObservation?.Admitted() == true)
                    precedingSourceUiIncomplete = true;
                if (sourceObservation is null) resources = CaptureResources(request, owner, windowSamples, resourceAdmitted);
            }
            else if (sourceContext is not null && singlePrompt && windowSweepComplete && !precedingSourceUiIncomplete &&
                windowSamples.Sum(MsiWindowObservation.CountClosingPrompts) == 1 &&
                firstInstaller is not null && samePrompt is not null && sourceRead is not null)
            {
                (firstPrompt, resources) = ReadFirstSourcePrompt(owner, firstInstaller, sourceContext, sourceRead,
                    firstPrompt, sourceStateAtPrompt, samePrompt, () => sourceContext.Admitted() && resourceAdmitted());
            }
            if (windows is not null) windowDelivery = windows.Publish(windowSamples, observedElapsed, () => stopped, resources, firstPrompt);
            return Combine(owned, outside, unknown);
        }
        catch
        {
            MarkIncompleteSourceSweep(sourceContext);
            return WorkspaceMsiMembership.Unknown;
        }
        finally
        {
            firstInstaller?.Dispose();
            foreach (var client in clients) client.Dispose();
        }
    }

    private void MarkIncompleteSourceSweep(MsiSourceObservationContext? scopedAtStart)
    {
        if (sourceObservation is null || firstSourcePromptRead) return;
        try { precedingSourceUiIncomplete |= scopedAtStart is not null || sourceObservation.Admitted(); }
        catch { precedingSourceUiIncomplete = true; }
    }

    private static MsiResourceObservation.SourceRead? RetainOptionalSource(MsiSourceObservationContext? source)
    {
        try { return source?.RetainSource(); }
        catch { return null; }
    }

    private (MsiSourceObservation Observation, MsiResourceSample? Resources) ReadFirstSourcePrompt(WindowsJob owner,
        SafeProcessHandle installer, MsiSourceObservationContext source, MsiResourceObservation.SourceRead sourceRead,
        MsiSourceObservation observation, string sourceStateAtPrompt, Func<bool> samePrompt, Func<bool> admitted)
    {
        if (request is null || stopped || !source.Admitted() ||
            ObserveHandle(owner, installer) != WorkspaceMsiMembership.Owned || !sourceRead.IsDirectChild(installer))
            return (observation, null);
        observation = observation with { SourceState = sourceStateAtPrompt };
        if (!admitted()) return (observation, null);
        long? queryStart = null, queryEnd = null;
        bool? liveBefore = null, liveAfter = null;
        try
        {
            var sample = MsiResourceObservation.Capture(request, owner, admitted,
                beforeQuery: () =>
                {
                    if (!admitted() || !samePrompt() || !sourceRead.IsDirectChild(installer) || !admitted())
                        throw new InvalidOperationException("msiSourcePromptChanged");
                    liveBefore = sourceRead.IsLive();
                    queryStart = source.ElapsedMilliseconds();
                },
                afterQuery: () => { queryEnd = source.ElapsedMilliseconds(); liveAfter = sourceRead.IsLive(); },
                sourceRead: sourceRead);
            if (queryStart is null || queryEnd is null) return (observation, sample);
            var relation = admitted() && samePrompt() && admitted() &&
                ObserveHandle(owner, installer) == WorkspaceMsiMembership.Owned && sourceRead.IsDirectChild(installer)
                ? MsiResourceObservation.ClassifySource(sample, sourceRead.Birth,
                    sourceStateAtPrompt == "alive" && liveBefore is true && liveAfter is true)
                : "unknown";
            return (observation with { Relation = relation, ResourceQueryStartMs = queryStart, ResourceQueryEndMs = queryEnd }, sample);
        }
        catch { return (observation, new("unavailable", null, 0, null, null, [])); }
    }

    internal Func<bool> ResourceAdmission(Func<long> elapsedMilliseconds) =>
        () => !stopped && elapsedMilliseconds() < MsiWindowObservation.Contract.ResourceTimeoutMilliseconds;

    internal static MsiResourceSample? CaptureResources(SupervisorRequest? request, WindowsJob owner,
        IReadOnlyList<MsiWindowSample> samples, Func<bool> admitted,
        Func<SupervisorRequest, WindowsJob, Func<bool>, MsiResourceSample>? captureResources = null)
    {
        if (request is null || !admitted() || !samples.Any(sample => MsiWindowObservation.CountClosingPrompts(sample) > 0)) return null;
        try { return captureResources is null ? MsiResourceObservation.Capture(request, owner, admitted) :
            captureResources(request, owner, admitted); }
        catch { return new("unavailable", null, 0, null, null, []); }
    }

    internal static WorkspaceMsiMembership Combine(bool owned, bool outside, bool unknown) =>
        unknown ? WorkspaceMsiMembership.Unknown : (owned, outside) switch
        {
            (true, true) => WorkspaceMsiMembership.Mixed,
            (true, false) => WorkspaceMsiMembership.Owned,
            (false, true) => WorkspaceMsiMembership.Outside,
            _ => WorkspaceMsiMembership.None,
        };

    internal static WorkspaceMsiMembership ObserveHandle(WindowsJob owner, SafeProcessHandle process,
        Action? afterMembership = null)
    {
        try
        {
            if (process.IsClosed || process.IsInvalid ||
                NativeMethods.WaitForSingleObject(process, 0) != NativeMethods.WaitTimeout)
                return WorkspaceMsiMembership.Unknown;
            var owned = owner.ContainsProcess(process);
            afterMembership?.Invoke();
            if (NativeMethods.WaitForSingleObject(process, 0) != NativeMethods.WaitTimeout)
                return WorkspaceMsiMembership.Unknown;
            return owned ? WorkspaceMsiMembership.Owned : WorkspaceMsiMembership.Outside;
        }
        catch { return WorkspaceMsiMembership.Unknown; }
    }

    private const uint QueryLimitedInformation = 0x1000;
    private const uint Synchronize = 0x100000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, StringBuilder name, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
}
