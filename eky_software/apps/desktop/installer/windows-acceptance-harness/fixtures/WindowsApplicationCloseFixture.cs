using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace Eky.WindowsAcceptance.Tests
{
    public static class WindowsApplicationCloseFixture
    {
        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                if (args.Length == 2 && args[0] == "signalExit")
                {
                    using (var signal = EventWaitHandle.OpenExisting(args[1])) signal.WaitOne();
                    return 0;
                }
                if (args.Length != 4) return 64;
                Action observing = delegate { File.WriteAllText(args[3], "observing"); };
                File.WriteAllText(args[3], "fixtureStarted");
                var outcome = Exercise(args[0], observing, args[3]);
                if (outcome != 0) return outcome;
                File.WriteAllText(args[3], "completed");
                File.Copy(args[1], args[2], false);
                return 0;
            }
            catch { return 67; }
        }

        private static int Exercise(string mode, Action observing, string phasePath)
        {
            if (mode == "exited" || mode == "exitWhileWaiting")
            {
                var name = "eky-window-exit-" + Guid.NewGuid().ToString("N");
                using (var signal = new EventWaitHandle(false, EventResetMode.ManualReset, name))
                using (var child = Process.Start(new ProcessStartInfo(
                    Assembly.GetExecutingAssembly().Location, "signalExit " + name)
                    { UseShellExecute = false }))
                {
                    var waitingObserved = false;
                    if (mode == "exited")
                    {
                        signal.Set();
                        child.WaitForExit();
                    }
                    var outcome = WindowsApplicationCloseRequest.Request(child, delegate
                    {
                        waitingObserved = true;
                        observing();
                        signal.Set();
                    });
                    child.WaitForExit();
                    return outcome == 65 && child.ExitCode == 0 &&
                        (mode != "exitWhileWaiting" || waitingObserved) ? 0 : 1;
                }
            }

            using (var current = Process.GetCurrentProcess())
            {
                if (mode == "absent") return WindowsApplicationCloseRequest.Request(current, observing);
                if (mode != "visible" && mode != "delayed") return 64;

                using (var show = new ManualResetEvent(mode == "visible"))
                using (var shown = new ManualResetEvent(false))
                {
                    var closeCount = 0;
                    var ui = new Thread(delegate()
                    {
                        show.WaitOne();
                        using (var window = new Form())
                        {
                            window.Text = "Eky synthetic close contract";
                            window.Shown += delegate
                            {
                                File.WriteAllText(phasePath, "windowShown");
                                shown.Set();
                            };
                            window.FormClosing += delegate { Interlocked.Increment(ref closeCount); };
                            Application.Run(window);
                        }
                    });
                    ui.SetApartmentState(ApartmentState.STA);
                    ui.Start();
                    if (mode == "visible") shown.WaitOne();

                    // Only an actual empty first lookup may release the delayed window.
                    var outcome = WindowsApplicationCloseRequest.Request(current, delegate
                    {
                        observing();
                        show.Set();
                    });
                    if (outcome != 0) return outcome;
                    File.WriteAllText(phasePath, "closeRequested");
                    ui.Join();
                    return closeCount == 1 ? 0 : 1;
                }
            }
        }
    }
}
