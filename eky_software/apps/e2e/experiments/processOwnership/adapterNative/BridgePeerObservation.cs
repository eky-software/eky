using System.IO.Pipes;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record BridgePeerIdentity(uint ProcessId, ulong CreationTime);

// Peer-bound observation only. This is neither a creator handle nor workload ownership.
internal sealed class BridgePeerObservation : IDisposable
{
    internal const uint ReadOnlyAccess = 0x00100000 | 0x00001000;
    private readonly object gate = new();
    private readonly IBridgePeerNativeOperations native;
    private SafeProcessHandle? process;
    private BridgePeerIdentity? identity;
    private string? failure;
    private bool disposed;

    private BridgePeerObservation(IBridgePeerNativeOperations native) => this.native = native;

    // The caller must authenticate the candidate and enforce one acquisition per launch.
    // Challenge/role verification and GO remain the registration protocol's responsibility.
    internal static BridgePeerObservation Acquire(NamedPipeServerStream control, NamedPipeServerStream output,
        NamedPipeServerStream error, uint observedPid) => Acquire(
            new BridgePeerNativeOperations(control, output, error), observedPid);

    internal static BridgePeerObservation Acquire(IBridgePeerNativeOperations native, uint observedPid)
    {
        var observation = new BridgePeerObservation(native);
        try
        {
            if (observedPid == 0) throw new AdapterFailure("bridgePeerIdentityInvalid");
            observation.RequirePeers(observedPid);
            observation.process = native.OpenProcess(ReadOnlyAccess, false, observedPid);
            if (observation.process is null || observation.process.IsInvalid || observation.process.IsClosed)
                throw new AdapterFailure("bridgePeerOpenFailed");
            observation.RequireAlive();
            observation.identity = observation.ReadIdentity();
            if (observation.identity.ProcessId != observedPid) throw new AdapterFailure("bridgePeerIdentityMismatch");
            observation.RequirePeers(observedPid);
            observation.RequireAlive();
            return observation;
        }
        catch (Exception error)
        {
            observation.Dispose();
            throw SafeFailure(error);
        }
    }

    internal BridgePeerIdentity Identity
    {
        get
        {
            lock (gate)
            {
                RequireUsable();
                return identity!;
            }
        }
    }

    internal void RequireAliveAndBound()
    {
        lock (gate)
        {
            RequireUsable();
            try
            {
                RequireAlive();
                if (ReadIdentity() != identity) throw new AdapterFailure("bridgePeerIdentityMismatch");
                RequirePeers(identity!.ProcessId);
                RequireAlive();
            }
            catch (Exception error)
            {
                var safe = SafeFailure(error);
                failure = safe.Code;
                throw safe;
            }
        }
    }

    private void RequireUsable()
    {
        if (disposed) throw new AdapterFailure("bridgePeerDisposed");
        if (failure is not null) throw new AdapterFailure(failure);
        if (identity is null || process is null || process.IsInvalid || process.IsClosed)
            throw new AdapterFailure("bridgePeerObservationFailed");
    }

    private void RequirePeers(uint expectedPid)
    {
        if (!native.TryGetConnectedPeerIds(out var control, out var output, out var error))
            throw new AdapterFailure("bridgePeerQueryFailed");
        if (control == 0 || control != expectedPid || output != expectedPid || error != expectedPid)
            throw new AdapterFailure("bridgePeerMismatch");
    }

    private BridgePeerIdentity ReadIdentity()
    {
        var pid = native.GetProcessId(process!);
        if (pid == 0 || !native.TryGetCreationTime(process!, out var creation))
            throw new AdapterFailure("bridgePeerIdentityReadFailed");
        if (creation == 0 || creation > long.MaxValue) throw new AdapterFailure("bridgePeerIdentityInvalid");
        return new(pid, creation);
    }

    private void RequireAlive()
    {
        switch (native.WaitForSingleObject(process!, 0))
        {
            case BridgePeerNativeMethods.WaitTimeout: return;
            case BridgePeerNativeMethods.WaitObject0: throw new AdapterFailure("bridgePeerExited");
            default: throw new AdapterFailure("bridgePeerWaitFailed");
        }
    }

    internal static bool IsFailureCode(string code) => code is
        "bridgePeerIdentityInvalid" or "bridgePeerQueryFailed" or "bridgePeerMismatch" or
        "bridgePeerOpenFailed" or "bridgePeerIdentityReadFailed" or "bridgePeerIdentityMismatch" or
        "bridgePeerExited" or "bridgePeerWaitFailed" or "bridgePeerDisposed" or "bridgePeerObservationFailed";

    private static AdapterFailure SafeFailure(Exception error) => new(
        error is AdapterFailure known && IsFailureCode(known.Code) ? known.Code : "bridgePeerObservationFailed");

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            process?.Dispose();
        }
    }
}
