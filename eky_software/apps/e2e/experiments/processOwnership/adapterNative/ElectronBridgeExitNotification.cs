namespace Eky.ProcessOwnershipAdapter;

// A partial/failed write is ambiguous and must never be retried on the same framed pipe.
internal sealed class ElectronBridgeExitNotification
{
    private bool attempted;
    internal async Task SendOnceAsync(Func<Task> send)
    {
        if (attempted) return;
        attempted = true;
        await send();
    }
}
