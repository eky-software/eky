using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

// Injected contracts only: no real pipe, process, native call, or process-exit proof.
internal static class BridgePeerObservationSelfTest
{
    internal static int RunChecks()
    {
        var checks = 0;
        void Check(bool condition)
        {
            checks++;
            if (!condition) throw new AdapterFailure("bridgePeerSelfTestFailed");
        }
        void Reject(Action action, string code)
        {
            try { action(); }
            catch (AdapterFailure error)
            {
                Check(error.Code == code && error.Message == code && error.InnerException is null);
                return;
            }
            throw new AdapterFailure("bridgePeerSelfTestFailed");
        }

        using (var native = new FakeNative())
        {
            var observation = BridgePeerObservation.Acquire(native, 7);
            Check(observation.Identity == new BridgePeerIdentity(7, 123));
            Check(native.Access == 0x00101000 && !native.Inherit && native.OpenPid == 7 && native.OpenCalls == 1);
            Check(native.Calls.SequenceEqual(["peers", "open", "wait", "pid", "birth", "peers", "wait"]));
            observation.RequireAliveAndBound();
            observation.RequireAliveAndBound();
            Check(native.OpenCalls == 1 && native.PeerCalls == 4 && native.SameHandle && native.ZeroWaits);
            Check(!native.Process.IsClosed);
            observation.Dispose(); observation.Dispose();
            Check(native.Process.IsClosed);
            var calls = native.Calls.Count;
            Reject(observation.RequireAliveAndBound, "bridgePeerDisposed");
            Reject(() => _ = observation.Identity, "bridgePeerDisposed");
            Check(native.Calls.Count == calls && native.OpenCalls == 1);
        }

        using (var native = new FakeNative())
        {
            Reject(() => BridgePeerObservation.Acquire(native, 0), "bridgePeerIdentityInvalid");
            Check(native.OpenCalls == 0 && native.PeerCalls == 0);
        }
        foreach (var peers in new[] { (0u, 7u, 7u), (8u, 7u, 7u), (7u, 8u, 7u), (7u, 7u, 8u), (8u, 8u, 8u) })
        {
            using var native = new FakeNative { Peers = peers };
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerMismatch");
            Check(native.OpenCalls == 0 && !native.Process.IsClosed);
        }
        using (var native = new FakeNative { PeerReadSucceeds = false })
        {
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerQueryFailed");
            Check(native.OpenCalls == 0);
        }
        foreach (var invalid in new[] { IntPtr.Zero, new IntPtr(-1) })
        {
            using var native = new FakeNative(invalid);
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerOpenFailed");
            Check(native.OpenCalls == 1 && native.Process.IsClosed);
        }
        using (var native = new FakeNative())
        {
            native.Process.Dispose();
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerOpenFailed");
            Check(native.OpenCalls == 1);
        }

        foreach (var test in new (Action<FakeNative> Change, string Code)[]
        {
            (value => value.ProcessId = 0, "bridgePeerIdentityReadFailed"),
            (value => value.ProcessId = 8, "bridgePeerIdentityMismatch"),
            (value => value.BirthReadSucceeds = false, "bridgePeerIdentityReadFailed"),
            (value => value.CreationTime = 0, "bridgePeerIdentityInvalid"),
            (value => value.CreationTime = (ulong)long.MaxValue + 1, "bridgePeerIdentityInvalid"),
            (value => value.WaitResult = 0, "bridgePeerExited"),
            (value => value.WaitResult = uint.MaxValue, "bridgePeerWaitFailed"),
            (value => value.WaitResult = 0x80, "bridgePeerWaitFailed"),
        })
        {
            using var native = new FakeNative();
            test.Change(native);
            Reject(() => BridgePeerObservation.Acquire(native, 7), test.Code);
            Check(native.OpenCalls == 1 && native.Process.IsClosed && native.SameHandle);
        }
        using (var native = new FakeNative { CreationTime = (ulong)long.MaxValue })
        {
            using var observation = BridgePeerObservation.Acquire(native, 7);
            Check(observation.Identity.CreationTime == (ulong)long.MaxValue);
        }
        using (var native = new FakeNative())
        {
            using var observation = BridgePeerObservation.Acquire(native, 7);
            native.AfterPeerRead = () => native.WaitResult = 0;
            Reject(observation.RequireAliveAndBound, "bridgePeerExited");
            Check(native.OpenCalls == 1 && native.PeerCalls == 3 && !native.Process.IsClosed);
        }

        // Races after OpenProcess or the first successful wait never cause a second acquisition.
        foreach (var test in new (Action<FakeNative> Change, string Code)[]
        {
            (value => value.OnSecondPeerRead = () => value.Peers = (7, 8, 7), "bridgePeerMismatch"),
            (value => value.OnSecondPeerRead = () => value.PeerReadSucceeds = false, "bridgePeerQueryFailed"),
            (value => value.OnSecondWait = () => value.WaitResult = 0, "bridgePeerExited"),
        })
        {
            using var native = new FakeNative();
            test.Change(native);
            Reject(() => BridgePeerObservation.Acquire(native, 7), test.Code);
            Check(native.OpenCalls == 1 && native.Process.IsClosed);
        }

        foreach (var test in new (Action<FakeNative> Change, string Code)[]
        {
            (value => value.Peers = (8, 7, 7), "bridgePeerMismatch"),
            (value => value.Peers = (7, 8, 7), "bridgePeerMismatch"),
            (value => value.Peers = (7, 7, 8), "bridgePeerMismatch"),
            (value => value.PeerReadSucceeds = false, "bridgePeerQueryFailed"),
            (value => value.ProcessId = 8, "bridgePeerIdentityMismatch"),
            (value => value.CreationTime = 124, "bridgePeerIdentityMismatch"),
            (value => value.BirthReadSucceeds = false, "bridgePeerIdentityReadFailed"),
            (value => value.WaitResult = 0, "bridgePeerExited"),
            (value => value.WaitResult = uint.MaxValue, "bridgePeerWaitFailed"),
        })
        {
            using var native = new FakeNative();
            using var observation = BridgePeerObservation.Acquire(native, 7);
            test.Change(native);
            Reject(observation.RequireAliveAndBound, test.Code);
            Check(!native.Process.IsClosed && native.OpenCalls == 1);
            native.ResetResults();
            var calls = native.Calls.Count;
            Reject(observation.RequireAliveAndBound, test.Code);
            Reject(() => _ = observation.Identity, test.Code);
            Check(native.Calls.Count == calls && native.OpenCalls == 1);
            observation.Dispose();
            Check(native.Process.IsClosed);
        }

        foreach (var operation in new[] { "peers", "open", "wait", "pid", "birth" })
        {
            using var native = new FakeNative { ThrowOn = operation };
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerObservationFailed");
            Check(native.Process.IsClosed == (operation is "wait" or "pid" or "birth"));
            Check(native.OpenCalls <= 1);
        }
        foreach (var operation in new[] { "peers", "wait", "pid", "birth" })
        {
            using var native = new FakeNative();
            using var observation = BridgePeerObservation.Acquire(native, 7);
            native.ThrowOn = operation;
            Reject(observation.RequireAliveAndBound, "bridgePeerObservationFailed");
            Check(native.OpenCalls == 1 && !native.Process.IsClosed);
        }
        using (var native = new FakeNative { ThrowOn = "open", ThrowAdapterFailure = true })
            Reject(() => BridgePeerObservation.Acquire(native, 7), "bridgePeerObservationFailed");

        Check(!BridgePeerObservation.IsFailureCode("private detail"));
        return checks;
    }

    private sealed class FakeNative : IBridgePeerNativeOperations, IDisposable
    {
        // Non-owning synthetic handles cannot close an OS handle, even on failed assertions.
        internal readonly SafeProcessHandle Process;
        internal readonly List<string> Calls = [];
        internal (uint Control, uint Output, uint Error) Peers = (7, 7, 7);
        internal uint ProcessId = 7;
        internal ulong CreationTime = 123;
        internal bool PeerReadSucceeds = true;
        internal bool BirthReadSucceeds = true;
        internal uint WaitResult = 0x102;
        internal string? ThrowOn;
        internal bool ThrowAdapterFailure;
        internal Action? OnSecondPeerRead;
        internal Action? OnSecondWait;
        internal Action? AfterPeerRead;
        internal int OpenCalls;
        internal int PeerCalls;
        private int waitCalls;
        internal uint Access;
        internal bool Inherit;
        internal uint OpenPid;
        internal bool SameHandle = true;
        internal bool ZeroWaits = true;

        internal FakeNative() : this(new IntPtr(101)) { }
        internal FakeNative(IntPtr handle) => Process = new SafeProcessHandle(handle, false);
        private void Call(string operation)
        {
            Calls.Add(operation);
            if (ThrowOn == operation)
            {
                if (ThrowAdapterFailure) throw new AdapterFailure("private detail");
                throw new IOException("private detail");
            }
        }
        public bool TryGetConnectedPeerIds(out uint control, out uint output, out uint error)
        {
            PeerCalls++;
            if (PeerCalls == 2) OnSecondPeerRead?.Invoke();
            Call("peers");
            (control, output, error) = Peers;
            AfterPeerRead?.Invoke();
            return PeerReadSucceeds;
        }
        public SafeProcessHandle OpenProcess(uint access, bool inherit, uint processId)
        {
            OpenCalls++; Access = access; Inherit = inherit; OpenPid = processId;
            Call("open");
            return Process;
        }
        public uint GetProcessId(SafeProcessHandle process)
        {
            SameHandle &= ReferenceEquals(Process, process);
            Call("pid");
            return ProcessId;
        }
        public bool TryGetCreationTime(SafeProcessHandle process, out ulong creationTime)
        {
            SameHandle &= ReferenceEquals(Process, process);
            Call("birth");
            creationTime = CreationTime;
            return BirthReadSucceeds;
        }
        public uint WaitForSingleObject(SafeProcessHandle process, uint milliseconds)
        {
            SameHandle &= ReferenceEquals(Process, process);
            ZeroWaits &= milliseconds == 0;
            if (++waitCalls == 2) OnSecondWait?.Invoke();
            Call("wait");
            return WaitResult;
        }
        internal void ResetResults()
        {
            Peers = (7, 7, 7); ProcessId = 7; CreationTime = 123;
            PeerReadSucceeds = BirthReadSucceeds = true; WaitResult = 0x102;
        }
        public void Dispose() => Process.Dispose();
    }
}
