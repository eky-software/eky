using System.Diagnostics.Tracing;
using System.Text;
using System.Text.Json;
using Eky.NativeMsiTestAdapter;

internal static class NativeProductInspectionContract
{
    internal static int Run(string encoded)
    {
        using var input = JsonDocument.Parse(Convert.FromBase64String(encoded));
        var value = input.RootElement;
        var mode = value.GetProperty("mode").GetString()!;
        var path = value.GetProperty("resultPath").GetString()!;
        var observationPath = value.GetProperty("observationPath").GetString()!;
        using var listener = new InspectionListener(observationPath, mode == "observerFailure");
        if (mode == "foreignProvider")
        {
            using var foreign = new EventSource("Eky-SyntheticForeignProvider");
            listener.EnableEvents(foreign, EventLevel.Verbose);
            foreign.Write("scriptStarted");
            foreign.Write("TargetFrameworkSet");
        }
        if (mode == "propertyFailures")
        {
            foreach (var code in new uint[] { 87, 1605, 1608, 1610, 234 })
            {
                var query = new NativeProductQueries { ProductInfo =
                    (string product, string property, StringBuilder? buffer, ref uint length) => code };
                var rejected = false;
                try { query.ReadProperty("synthetic", "ProductName"); }
                catch (InvalidOperationException) { rejected = true; }
                if (!rejected) return 65;
            }
        }
        var synthetic = mode is "absent" or "advertised" or "foreignUser" or "installed" or
            "invalidState" or "propertyFailure" or "propertyGrowth" or "propertyOverflow" or
            "registryFailure" or "processFailure" or "fileFailure" or "propertySizeProbe" or
            "advertisedPropertyUnavailable" or "foreignUserPropertyUnavailable";
        var queries = new NativeProductQueries
        {
            ProductState = product =>
            {
                if (mode == "queryFailure") throw new InvalidOperationException();
                if (mode == "queryHold") Hold();
                return mode switch { "invalidState" => -2, "absent" => -1,
                    "advertised" or "advertisedPropertyUnavailable" => 1,
                    "foreignUser" or "foreignUserPropertyUnavailable" => 2,
                    _ when synthetic => 5, _ => new NativeProductQueries().ProductState(product) };
            },
            ProductInfo = (string product, string property, StringBuilder? buffer, ref uint length) =>
            {
                if (mode == "propertyFailure") return 1610;
                if (mode is "advertisedPropertyUnavailable" or "foreignUserPropertyUnavailable") return 1608;
                if (mode == "propertyOverflow") { length = NativeProductInspection.MaximumResultBytes + 1; return 0; }
                if (mode == "propertyGrowth" && buffer is not null) { length += 1; return 234; }
                var text = property switch { "ProductName" => "Eky \u00e4 synthetic", "VersionString" => "0.2.7",
                    "LocalPackage" => "synthetic cache.msi", _ => throw new InvalidOperationException() };
                if (buffer is not null)
                {
                    if (length != text.Length + 1) throw new InvalidOperationException();
                    buffer.Append(text);
                }
                length = (uint)text.Length;
                return mode == "propertySizeProbe" && buffer is null ? 234u : 0u;
            },
            FilePresent = file => mode == "fileFailure" ? throw new IOException() : file == "synthetic cache.msi",
            RegistryPresent = () => mode == "registryFailure" ? throw new IOException() : synthetic && mode != "absent",
            ProcessCount = () => mode == "processFailure" ? throw new InvalidOperationException() : synthetic && mode != "absent" ? 2 : 0,
        };
        FileStream? heldFile = null;
        try
        {
            return NativeProductInspection.Run(["--inspect-product", "--product-code",
                "{00000000-0000-0000-0000-000000000000}", "--result-path", path], queries, phase =>
                {
                    if (mode == "publishRace" && phase == "resultPublishStarted") File.WriteAllText(path, "sentinel");
                    if (mode == "cleanupFailure" && phase == "resultPublishStarted")
                    {
                        var temporary = Directory.GetFiles(Path.GetDirectoryName(path)!, Path.GetFileName(path) + ".*.tmp").Single();
                        heldFile = new FileStream(temporary, FileMode.Open, FileAccess.Read, FileShare.None);
                    }
                    if (mode == "resultBeforeExit" && phase == "resultPublishCompleted") Hold();
                });
        }
        finally { heldFile?.Dispose(); }
    }

    private static void Hold()
    {
        // Intentional blocked native boundary; only the existing enclosing Job can end it.
        using var held = new ManualResetEvent(false);
        held.WaitOne();
    }

    private sealed class InspectionListener(string path, bool fail) : EventListener
    {
        private readonly List<object> events = [];
        protected override void OnEventSourceCreated(EventSource source)
        {
            if (source.Name == NativeProductInspection.ProviderName) EnableEvents(source, EventLevel.Verbose);
        }
        protected override void OnEventWritten(EventWrittenEventArgs value)
        {
            if (value.EventSource.Name != NativeProductInspection.ProviderName || value.EventName == "EventSourceMessage") return;
            events.Add(new { phase = value.EventName, payloadCount = value.Payload?.Count ?? 0 });
            File.WriteAllText(path, JsonSerializer.Serialize(new { schemaVersion = 1, events }));
            if (fail) throw new InvalidOperationException();
        }
    }
}
