using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Eky.WindowsAcceptance
{
    public static class WindowsApplicationCloseRequest
    {
        private const uint EventObjectShow = 0x8002;
        private const uint OutOfContext = 0;
        private const uint AllInput = 0x04ff;
        private const uint RemoveMessage = 1;
        private const uint Infinite = 0xffffffff;

        private delegate void WindowEvent(
            IntPtr hook, uint eventId, IntPtr window, int objectId,
            int childId, uint threadId, uint timestamp);

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            public IntPtr Window;
            public uint Id;
            public UIntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public int X;
            public int Y;
            public uint Private;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(
            uint minimum, uint maximum, IntPtr module, WindowEvent callback,
            uint processId, uint threadId, uint flags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWinEvent(IntPtr hook);

        [DllImport("user32.dll")]
        private static extern uint MsgWaitForMultipleObjects(
            uint count, IntPtr[] handles, [MarshalAs(UnmanagedType.Bool)] bool all,
            uint milliseconds, uint wakeMask);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PeekMessage(
            out Message message, IntPtr window, uint minimum, uint maximum, uint remove);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref Message message);

        public static int Request(Process target, Action waitingForWindow)
        {
            if (target == null || target.Id <= 0 || target.HasExited) return 65;
            var processHandle = target.Handle;
            var inspectWindow = true;
            WindowEvent callback = delegate(
                IntPtr hook, uint eventId, IntPtr window, int objectId,
                int childId, uint threadId, uint timestamp)
            {
                if (objectId == 0 && childId == 0) inspectWindow = true;
            };
            var callbackHandle = GCHandle.Alloc(callback);
            var subscription = IntPtr.Zero;
            try
            {
                subscription = SetWinEventHook(
                    EventObjectShow, EventObjectShow, IntPtr.Zero, callback,
                    (uint)target.Id, 0, OutOfContext);
                if (subscription == IntPtr.Zero) return 68;

                // Subscribe before the first lookup so an already-visible or newly-shown window is observed.
                var handles = new[] { processHandle };
                var waitingReported = false;
                for (;;)
                {
                    if (inspectWindow)
                    {
                        inspectWindow = false;
                        target.Refresh();
                        if (target.HasExited) return 65;
                        if (target.MainWindowHandle != IntPtr.Zero)
                        {
                            return target.CloseMainWindow() ? 0 : 66;
                        }
                    }

                    if (!waitingReported)
                    {
                        waitingReported = true;
                        if (waitingForWindow != null) waitingForWindow();
                    }

                    // The existing Job supervisor owns the deadline, including this event-only wait.
                    var outcome = MsgWaitForMultipleObjects(1, handles, false, Infinite, AllInput);
                    if (outcome == 0) return 65;
                    if (outcome != 1) return 68;
                    Message message;
                    while (PeekMessage(out message, IntPtr.Zero, 0, 0, RemoveMessage))
                    {
                        DispatchMessage(ref message);
                    }
                }
            }
            finally
            {
                if (subscription != IntPtr.Zero) UnhookWinEvent(subscription);
                callbackHandle.Free();
            }
        }
    }
}
