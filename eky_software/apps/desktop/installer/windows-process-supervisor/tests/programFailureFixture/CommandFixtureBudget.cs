namespace Eky.WindowsProcessSupervisor;

// Only the injected fault phase is accelerated. Normal synthetic work uses
// the existing ordinary V2 phase reservation, including failure publication.
internal static class CommandFixtureBudget
{
    internal static (int Timeout, int Cleanup) Resolve(string testCase, string kind, string phase)
    {
        var heldPhase = testCase switch
        {
            "preparationHold" => "prepare",
            "productInspectionHold" => "inspectSourceBefore",
            "requestPreparationHold" or "requestPreparationLate" => "inspectSourceBefore",
            "scenarioHold" or "msiProcessHold" => "scenario",
            "uninstallHold" or "resultBeforeExit" => kind == "clean" ? "uninstallSource" : "uninstallTarget",
            "removalHold" => "fixtureCleanup",
            "publicationBeforeExit" => "publish",
            _ => null,
        };
        return phase == heldPhase ? (4_000, 1_000) : (35_000, 5_000);
    }
}
