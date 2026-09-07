/* The exact command the button runs, and the one a member can read, copy, or
 * have typed into a terminal for them. Built the same way every other launch
 * in this plugin is: the resolved executable path first (never re-discovered
 * here - the caller passes the SAME path `resolveCliPath` already found),
 * then the flags. */

export type CommandPlatform = 'darwin' | 'win32' | 'linux';

/**
 * The flags Remote Control needs, in the CLI's own order. `displayName` and
 * `resumeSessionId` each ride as ONE argv entry; quoting for a shell is a
 * property of where the command is going to run, so it happens later, in
 * `remoteControlCommandLine` / `remoteControlArgv`, never here.
 */
export function remoteControlArgs(displayName: string, resumeSessionId: string): string[] {
  return ['--remote-control', displayName, '--resume', resumeSessionId];
}

/** The full argv, executable first - what a real spawn (an argument array) takes. */
export function remoteControlArgv(cliPath: string, displayName: string, resumeSessionId: string): string[] {
  return [cliPath, ...remoteControlArgs(displayName, resumeSessionId)];
}

/**
 * One POSIX shell argument, single-quoted. Single quotes admit no escape, so
 * an embedded one is closed, escaped as its own quoted literal, and reopened:
 * `it's` becomes `'it'\''s'`. Safe for a display name carrying a note title
 * with an apostrophe, double quotes, `$`, backticks or anything else a shell
 * would otherwise read as its own syntax.
 */
export function quotePosix(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * One cmd.exe argument. cmd has no real escape for a quote embedded inside a
 * quoted string; doubling it is the documented workaround, and the same rule
 * `cmd /k` itself applies when it re-parses its own argument. Anything with
 * whitespace or a cmd metacharacter is wrapped in quotes; a plain word is
 * left bare so a Windows member's clipboard paste reads the way they expect.
 */
export function quoteWindows(arg: string): string {
  const escaped = arg.replace(/"/g, '""');
  return /[\s"^&|<>()]/.test(arg) ? `"${escaped}"` : escaped;
}

export function quoteForPlatform(arg: string, platform: CommandPlatform): string {
  return platform === 'win32' ? quoteWindows(arg) : quotePosix(arg);
}

/** The full command as one line, quoted for `platform`, ready to read, copy, or type. */
export function remoteControlCommandLine(
  cliPath: string,
  displayName: string,
  resumeSessionId: string,
  platform: CommandPlatform,
): string {
  return remoteControlArgv(cliPath, displayName, resumeSessionId)
    .map((arg) => quoteForPlatform(arg, platform))
    .join(' ');
}
