using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class ShortPathContract
{
    internal static int Run(string inputPath)
    {
        try
        {
            using var input = JsonDocument.Parse(File.ReadAllText(inputPath));
            var value = input.RootElement;
            if (value.GetProperty("schemaVersion").GetInt32() != 1) return 64;
            var directory = value.GetProperty("directory").GetString()!;
            if (!Path.IsPathFullyQualified(directory)) return 64;
            var root = Path.GetDirectoryName(inputPath)!;
            if (value.GetProperty("hold").GetBoolean())
            {
                File.WriteAllText(Path.Combine(root, "short-path-started.json"),
                    "{\"schemaVersion\":1,\"phase\":\"lookupHeld\"}");
                using var held = new ManualResetEvent(false);
                held.WaitOne();
                return 1;
            }
            var required = GetShortPathNameW(directory, null, 0);
            if (required == 0 || required > 32_768) return 1;
            var buffer = new StringBuilder((int)required);
            var written = GetShortPathNameW(directory, buffer, required);
            if (written == 0 || written >= required) return 1;
            using var output = new FileStream(Path.Combine(root, "short-path-result.json"),
                FileMode.CreateNew, FileAccess.Write, FileShare.None);
            JsonSerializer.Serialize(output, new { schemaVersion = 1, shortPath = buffer.ToString() });
            return 0;
        }
        catch { return 1; }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetShortPathNameW(string path, StringBuilder? shortPath, uint capacity);
}
