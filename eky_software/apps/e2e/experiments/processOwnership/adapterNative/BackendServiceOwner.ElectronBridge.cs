namespace Eky.ProcessOwnershipAdapter;

internal sealed partial class BackendServiceOwner
{
    private ElectronBridgeChannel? bridgeChannel;
    private ElectronBridgeRegistration? bridgeRegistration;
    private bool bridgePeerObservationStarted;
    private readonly ElectronBridgeExitNotification bridgeExit = new();

    private void PrepareElectronBridge()
    {
        if (!config.IsElectronBridge) return;
        bridgeChannel = new(config.ElectronConfiguration!);
        bridgeRegistration = new(bridgeChannel.ConnectAsync,
            pid => bridgeChannel.AcquireGate(pid, clock.RequireWork), bridgeChannel.ExchangeAsync, clock.RequireWork);
    }

    private void BeginBridgeRegistration(BackendServiceRequest request)
    {
        if (bridgeRegistration is null) throw new AdapterFailure("protocolInvalid");
        clock.LatchWorkDeadline(request.WorkDeadlineElapsedMilliseconds ?? throw new AdapterFailure("protocolInvalid"));
        watchdog!.Change(TimeSpan.FromMilliseconds(clock.RemainingWork + BackendServiceProtocol.CleanupMilliseconds),
            Timeout.InfiniteTimeSpan);
        bridgeRegistration.Begin(request.ObservedBridgePid ?? throw new AdapterFailure("protocolInvalid"));
    }

    private void AdvanceBridgeRegistration()
    {
        if (bridgeRegistration is null) return;
        bridgeRegistration.Advance();
        if (bridgeRegistration.Receipt is not null && !bridgePeerObservationStarted)
        {
            bridgeChannel!.BeginPeerObservation();
            bridgePeerObservationStarted = true;
        }
        if (bridgePeerObservationStarted)
        {
            bridgeChannel!.RequireNoUnexpectedFrame(state.Workload == "exited");
            if (state.Workload != "exited") bridgeChannel.RequirePeer();
            else CloseSettledBridgeOutput();
        }
    }

    private void LaunchRegisteredBridge(string receipt)
    {
        if (bridgeRegistration is null) throw new AdapterFailure("protocolInvalid");
        var arguments = bridgeRegistration.AdmitGo(receipt);
        state.AdmitLaunch();
        try
        {
            clock.RequireWork();
            try { config.ValidatePaths(); }
            catch { throw new AdapterFailure("launchRejected"); }
            io = ChildStandardIo.Create();
            // Keep the peer pipes queryable until the owner has observed root exit.
            // Then close each destination only after its complete relay settlement.
            outputRelay = new ByteRelay(io.OutputReader, bridgeChannel!.Output, relayCancellation.Token);
            errorRelay = new ByteRelay(io.ErrorReader, bridgeChannel.Error, relayCancellation.Token);
            bridgeRegistration.RequireBeforeCreateOrResume();
            child = AdapterProcess.CreateElectronBridge(config, arguments, job!, io, state);
            state.Identify(child.ReadBackendIdentity());
            bridgeRegistration.RequireBeforeCreateOrResume();
            child.VerifyAndResume(job!, state);
            state.MarkStarted();
            // Exit after the last pre-resume check is still a workload failure with Job-owned cleanup.
            bridgeChannel.RequirePeer();
            clock.RequireWork();
        }
        finally
        {
            state.SettleCreation();
            io?.CloseChildEnds();
        }
    }

    private async Task SendBridgeAsync(string kind, int? exitCode)
    {
        if (bridgeChannel is null) return;
        using var bound = Bound();
        try
        {
            if (kind == "rootExit") await bridgeExit.SendOnceAsync(() => bridgeChannel.SendAsync(kind, exitCode, bound.Token));
            else await bridgeChannel.SendAsync(kind, exitCode, bound.Token);
        }
        catch { bridgeChannel.ClosePipes(); throw; }
        clock.RequireWork();
    }

    private void StopBridgeRegistration()
    {
        bridgeRegistration?.Stop();
        if (bridgeRegistration?.Failure is { } registrationFailure) state.Fail(registrationFailure);
        var observationFailure = bridgeChannel?.StopObservation(state.Workload == "exited");
        if (observationFailure is not null)
            state.Fail(ElectronBridgeServiceProtocol.OperationalFailure(new AdapterFailure(observationFailure)));
    }

    private async Task FinishBridgeWorkloadAsync(CancellationToken cleanup)
    {
        if (bridgeChannel is null || !state.Created || rootSent) return;
        if (state.Workload != "exited") { bridgeChannel.ClosePipes(); return; }
        try
        {
            await bridgeExit.SendOnceAsync(() => bridgeChannel.SendAsync("rootExit", state.ExitCode, cleanup));
            clock.RequireCleanup();
            rootSent = true;
        }
        catch { state.Fail("stdioFailed"); bridgeChannel.ClosePipes(); }
    }

    private async Task<bool> SettleBridgeAsync(CancellationToken cleanup)
    {
        if (bridgeRegistration is null) return true;
        CloseSettledBridgeOutput();
        var registration = await bridgeRegistration.SettleAsync(cleanup);
        if (registration.Failure is { } registrationFailure) state.Fail(registrationFailure);
        var observation = await bridgeChannel!.SettleObservationAsync(state.Workload == "exited", cleanup);
        if (observation.Failure is { } failure) state.Fail(ElectronBridgeServiceProtocol.OperationalFailure(new AdapterFailure(failure)));
        if (!state.Created) bridgeChannel.ClosePipes();
        return registration.Settled && observation.Settled;
    }

    private void CloseSettledBridgeOutput()
    {
        if (outputRelay?.IsSettled == true) bridgeChannel!.CloseOutput();
        if (errorRelay?.IsSettled == true) bridgeChannel!.CloseError();
    }
}
