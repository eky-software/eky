using System.Text;

namespace Eky.WindowsProcessSupervisor;

internal static class WindowsCommandLine
{
    internal static string Build(string command, IReadOnlyList<string> arguments)
    {
        var result = new StringBuilder(Quote(command));
        foreach (var argument in arguments)
        {
            result.Append(' ');
            result.Append(Quote(argument));
        }
        return result.ToString();
    }

    internal static string Quote(string value)
    {
        if (value.Length > 0 && !value.Any(character =>
                char.IsWhiteSpace(character) || character == '"'))
        {
            return value;
        }

        var result = new StringBuilder(value.Length + 2);
        result.Append('"');
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}
