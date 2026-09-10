using Eky.WindowsProcessSupervisor;

if (!SupervisorCallerAdmission.TryAccept(ref args)) return 64;

return args.Length > 0 && args[0] == "--product-operation"
    ? InstallerProductOperationProgram.Run(args)
    : SupervisorProgram.Run(args);
