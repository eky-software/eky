using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipExperiment;

internal sealed record ExperimentFiles(string Root, string Directory, string Node, string Fixture, string Case, string Nonce)
{
    internal static ExperimentFiles Read(string[] args)
    {
        if (!OperatingSystem.IsWindows() || Environment.GetEnvironmentVariable("EKY_E2E") != "1" || args.Length != 4)
            throw new InvalidOperationException("experimentArgumentsInvalid");
        var node = Path.GetFullPath(args[0]);
        var root = Path.GetFullPath(args[1]).TrimEnd(Path.DirectorySeparatorChar);
        var scenario = args[2];
        var nonce = args[3];
        if (!Path.IsPathFullyQualified(args[0]) || !File.Exists(node) ||
            !node.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
            !Path.IsPathFullyQualified(args[1]) ||
            !string.Equals(Path.GetDirectoryName(root), Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(root).StartsWith("eky-t3a-", StringComparison.Ordinal) ||
            !Regex.IsMatch(nonce, "\\A[0-9a-f]{64}\\z") ||
            scenario is not ("nodeRootFirst" or "nodeRootFailure" or "nodeStop" or "electronNormal" or "electronLaunchFailure"))
            throw new InvalidOperationException("experimentArgumentsInvalid");
        for (var cursor = new DirectoryInfo(root); cursor is not null; cursor = cursor.Parent)
            if (cursor.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidOperationException("experimentRootInvalid");
        var directory = Path.Combine(root, scenario);
        if (!System.IO.Directory.Exists(directory) || File.GetAttributes(directory).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("experimentRootInvalid");
        var temporary = Path.Combine(directory, "tmp");
        if (!System.IO.Directory.Exists(temporary) || File.GetAttributes(temporary).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("experimentTempInvalid");
        var fixture = Path.Combine(directory, scenario.StartsWith("node", StringComparison.Ordinal) ? "nodeTree.cjs" : "electronDriver.cjs");
        if (!File.Exists(fixture) || File.GetAttributes(fixture).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("experimentFixtureInvalid");
        if (Environment.GetEnvironmentVariable("EKY_T3A_ROOT") != root || Environment.GetEnvironmentVariable("EKY_T3A_CASE") != scenario)
            throw new InvalidOperationException("experimentEnvironmentInvalid");
        return new(root, directory, node, fixture, scenario, nonce);
    }

    internal void Write(string name, object value)
    {
        var temporary = Path.Combine(Directory, name + ".pending");
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(stream, value);
            stream.Flush(true);
        }
        File.Move(temporary, Path.Combine(Directory, name), false);
    }
}
