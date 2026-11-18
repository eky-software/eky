namespace Eky.WindowsProcessSupervisor;

internal sealed partial class SuspendedWindowsProcess
{
    private readonly object sourceObservationAdmission = new();
    private bool sourceObservationClosed;

    internal bool TryRetainSourceObservationHandle()
    {
        lock (sourceObservationAdmission)
        {
            if (sourceObservationClosed) return false;
            var retained = false;
            try { Process.DangerousAddRef(ref retained); return retained; }
            catch (ObjectDisposedException) { return false; }
        }
    }

    internal void CloseSourceObservationAdmission()
    {
        // Native validation and optional reads do not hold this gate.
        lock (sourceObservationAdmission) sourceObservationClosed = true;
    }
}
