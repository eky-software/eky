Set-StrictMode -Version Latest

function Initialize-W6bNativePathResolver {
  if ($null -ne ('Eky.W6b.NativePath' -as [type])) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.W6b
{
    public static class NativePath
    {
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint FileShareDelete = 0x00000004;
        private const uint OpenExisting = 3;
        private const uint FileFlagBackupSemantics = 0x02000000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder filePath,
            uint filePathLength,
            uint flags);

        public static string Resolve(string path)
        {
            SafeFileHandle handle = CreateFileW(
                path,
                0,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics,
                IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error);
            }

            try
            {
                StringBuilder buffer = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandleW(
                    handle,
                    buffer,
                    (uint)buffer.Capacity,
                    0);
                if (length == 0 || length >= buffer.Capacity)
                {
                    throw new IOException("W6B_NATIVE_PATH_RESOLUTION_FAILED");
                }

                string value = buffer.ToString();
                if (value.StartsWith(@"\\?\UNC\", StringComparison.Ordinal))
                {
                    return @"\\" + value.Substring(8);
                }
                if (value.StartsWith(@"\\?\", StringComparison.Ordinal))
                {
                    return value.Substring(4);
                }
                return value;
            }
            finally
            {
                handle.Dispose();
            }
        }
    }
}
'@
}

function Resolve-W6bCanonicalExistingPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw $Code
  }
  try {
    Initialize-W6bNativePathResolver
    return [IO.Path]::GetFullPath([Eky.W6b.NativePath]::Resolve($Path))
  }
  catch {
    throw $Code
  }
}
