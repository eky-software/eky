using Eky.WindowsProcessSupervisor;

return args.Length > 0 && args[0] == "--product-operation"
    ? InstallerProductOperationProgram.Run(args)
    : SupervisorProgram.Run(args);
