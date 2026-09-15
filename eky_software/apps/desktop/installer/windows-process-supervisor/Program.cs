using Eky.WindowsProcessSupervisor;

if (!SupervisorCallerAdmission.TryAccept(ref args)) return 64;

if (args.Length > 0 && args[0] is "--legacy-command" or "--clean-command" or "--upgrade-command" or "--workspace-success-command" or "--workspace-fault-command")
    return AcceptanceCommandProgram.Run(args);

return SupervisorProgram.Run(args);
