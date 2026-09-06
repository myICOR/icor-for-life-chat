/* Putting the Remote Control command where a member can run it, without ever
 * running it FOR them - the same rule `provider/install.ts` follows for a
 * vendor's install line, generalised to any launch: a plugin never spawns a
 * runtime on the vault's behalf, it hands the line to a terminal pane, the
 * OS's own terminal, or the clipboard, and the member presses Enter.
 *
 * Every side effect is a PORT, so the decision tree here is asserted headless
 * with fakes; `adapters.ts` is the one file that touches the real clipboard,
 * the real child process and the real ICOR for Life - Terminal plugin. */

import type { CommandPlatform } from './command';

export type LaunchRoute = 'terminal-plugin' | 'os-terminal' | 'clipboard';

export interface TerminalPluginPort {
  /** `icor-for-life-terminal`'s public `newTerminalWithText`: types the line into a
   * new pane, cwd second, never presses Enter. Resolves false on any failure. */
  newTerminalWithText: (text: string, cwd?: string) => Promise<boolean>;
}

export interface SpawnPort {
  /** Spawns `file` with `args` as literal argv entries - never a shell string,
   * so nothing in `args` (a note title, an apostrophe, a `&`) is re-parsed. */
  spawnDetached: (file: string, args: string[]) => void;
}

export interface ClipboardPort {
  writeText: (text: string) => Promise<void>;
}

export interface NoticePort {
  show: (message: string, durationMs?: number) => void;
}

export interface LaunchPorts {
  /** Null when the Terminal plugin is absent or disabled. */
  terminalPlugin: TerminalPluginPort | null;
  spawn: SpawnPort;
  clipboard: ClipboardPort;
  notice: NoticePort;
}

export interface LaunchRequest {
  /** The full, already-quoted command line - `remoteControlCommandLine`'s output. */
  commandLine: string;
  cwd: string;
  platform: CommandPlatform;
  isDesktopApp: boolean;
  /**
   * A terminal emulator's resolved path on Linux, found the SAME way every
   * other executable in this plugin is (`resolveExecutable` in
   * `provider/cli.ts`), so this function never touches the filesystem
   * itself. Null on darwin/win32 (unused there) or when none was found.
   */
  linuxTerminalPath: string | null;
}

function macAppleScript(commandLine: string, cwd: string): string {
  // `cd` into the vault first, with the SAME POSIX quoting the command line's
  // own arguments already went through - never a raw path dropped into the
  // string.
  const quotedCwd = `'${cwd.replace(/'/g, `'\\''`)}'`;
  const shellLine = `cd ${quotedCwd} && ${commandLine}`;
  // Escaping for the AppleScript double-quoted literal `do script "..."` is
  // the one further layer, applied to the WHOLE already-quoted shell line,
  // never to a bare note title.
  const escaped = shellLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "Terminal" to do script "${escaped}"\n` + 'tell application "Terminal" to activate';
}

/**
 * Route the command to wherever a member can run it. Desktop-only in
 * practice - the caller gates the button on `Platform.isDesktopApp` before
 * this is ever reached - but a non-desktop request still degrades safely to
 * the clipboard rather than throwing, because "what does this do on mobile"
 * is a question every port here can answer without a guess.
 */
export async function launchRemoteControlTerminal(req: LaunchRequest, ports: LaunchPorts): Promise<LaunchRoute> {
  if (!req.isDesktopApp) {
    await ports.clipboard.writeText(req.commandLine);
    ports.notice.show(
      'Remote Control opens a terminal on desktop only. The command is copied - paste it into a terminal.',
      10_000,
    );
    return 'clipboard';
  }

  if (ports.terminalPlugin) {
    let typed = false;
    try {
      typed = await ports.terminalPlugin.newTerminalWithText(req.commandLine, req.cwd);
    } catch {
      typed = false;
    }
    if (typed) {
      ports.notice.show(
        'Remote Control: the command is typed into a new terminal pane. Read it, then press Enter.',
        12_000,
      );
      return 'terminal-plugin';
    }
  }

  if (req.platform === 'darwin') {
    ports.spawn.spawnDetached('osascript', ['-e', macAppleScript(req.commandLine, req.cwd)]);
    ports.notice.show('Remote Control: opening Terminal.', 8_000);
    return 'os-terminal';
  }

  if (req.platform === 'win32') {
    ports.spawn.spawnDetached('cmd', ['/c', 'start', '', 'cmd', '/k', req.commandLine]);
    ports.notice.show('Remote Control: opening a command prompt.', 8_000);
    return 'os-terminal';
  }

  // Linux, best effort: only ever attempted once a terminal emulator was
  // actually found on PATH; otherwise the same clipboard fallback every
  // other route in this plugin uses when nothing else can be offered.
  if (req.linuxTerminalPath) {
    ports.spawn.spawnDetached(req.linuxTerminalPath, ['-e', req.commandLine]);
    ports.notice.show('Remote Control: opening a terminal.', 8_000);
    return 'os-terminal';
  }

  await ports.clipboard.writeText(req.commandLine);
  ports.notice.show('Remote Control: no terminal found to open automatically. The command is copied - paste it into a terminal.', 12_000);
  return 'clipboard';
}
