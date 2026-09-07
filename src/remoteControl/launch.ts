/* Putting the Remote Control command where a member can run it.
 *
 * Two different guarantees, and this file is honest about which route gives
 * which (Vex H2, 2026-09-07). With the ICOR for Life - Terminal plugin
 * installed, the command is TYPED into a new pane and the member presses
 * Enter - the plugin never runs it for them, the same rule
 * `provider/install.ts` follows for a vendor's install line. WITHOUT that
 * plugin, the macOS, Windows and Linux fallbacks below open a real terminal
 * window and RUN the command immediately, the moment the window opens: none
 * of the three OS terminals offers a type-then-wait mode from the outside, so
 * the "never runs it for them" guarantee does not extend past the
 * Terminal-plugin route. The README and the settings tab say the same thing.
 *
 * Every side effect is a PORT, so the decision tree here is asserted headless
 * with fakes; `adapters.ts` is the one file that touches the real clipboard,
 * the real child process and the real ICOR for Life - Terminal plugin. */

import type { CommandPlatform } from './command';
import { quoteWindows } from './command';

export type LaunchRoute = 'terminal-plugin' | 'os-terminal' | 'clipboard';

export interface TerminalPluginPort {
  /** `icor-for-life-terminal`'s public `newTerminalWithText`: types the line into a
   * new pane, cwd second, never presses Enter. Resolves false on any failure. */
  newTerminalWithText: (text: string, cwd?: string) => Promise<boolean>;
}

export interface SpawnOptions {
  /** The vault directory - every route the child can carry a cwd for gets one (Flint HIGH, Vex M2). */
  cwd?: string;
  /** Node's own escaping double-quotes an argument this file already quoted for
   * cmd.exe (Flint MEDIUM); set true only for an argv entry built to be taken
   * verbatim, and only on the Windows route that needs it. A no-op on darwin/linux. */
  windowsVerbatimArguments?: boolean;
  /** The child process exited. A non-zero code on the routes below means the
   * terminal never actually opened (Flint MEDIUM: a denied macOS Automation
   * grant is the traced case, `-1743`, no second prompt after "Don't Allow"). */
  onExit?: (code: number | null) => void;
  /** The child could not be spawned at all (a missing binary, a dead symlink). */
  onError?: (err: unknown) => void;
}

export interface SpawnPort {
  /** Spawns `file` with `args` as literal argv entries - never a shell string,
   * so nothing in `args` (a note title, an apostrophe, a `&`) is re-parsed. */
  spawnDetached: (file: string, args: string[], opts?: SpawnOptions) => void;
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
  /**
   * Called when an OS-terminal spawn failed to actually open a working
   * terminal (a denied macOS Automation grant, a missing binary, a dead
   * symlink). `reportSpawnFailure` below always fires this together with the
   * Notice and the clipboard copy, so nothing here is silent - the caller
   * uses it to undo a hand-off state it may already have painted, because by
   * the time a child's `exit`/`error` event arrives the synchronous part of
   * the hand-off has already run (Flint MEDIUM).
   */
  onSpawnFailure?: () => void;
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
 * What the member sees when an OS-terminal fallback's child could not be
 * started. A denied macOS Automation grant is the concrete case Flint traced
 * (Terminal.app refuses Obsidian's Apple Event with `-1743` and macOS never
 * asks a second time after "Don't Allow"), so darwin gets the exact fix; the
 * other two platforms get the same shape without guessing at a cause. The
 * command is copied either way - a failed automatic open never leaves the
 * member without the line to paste themselves.
 */
export function spawnFailureMessage(platform: CommandPlatform): string {
  const copied = 'The command is copied - paste it into a terminal.';
  if (platform === 'darwin') {
    return (
      'Remote Control could not open Terminal. If macOS is blocking Obsidian: System Settings, ' +
      `Privacy & Security, Automation, Obsidian, allow Terminal. ${copied}`
    );
  }
  return `Remote Control could not open a terminal automatically. ${copied}`;
}

async function reportSpawnFailure(req: LaunchRequest, ports: LaunchPorts): Promise<void> {
  await ports.clipboard.writeText(req.commandLine);
  ports.notice.show(spawnFailureMessage(req.platform), 15_000);
  ports.onSpawnFailure?.();
}

/** One set of `onExit`/`onError` handlers per spawn call, reporting at most
 * once: a real child can fire both an `error` and a later `exit`, and the
 * caller's rollback (`onSpawnFailure`) must not run twice for one launch. */
function failureHandlers(req: LaunchRequest, ports: LaunchPorts): Pick<SpawnOptions, 'onExit' | 'onError'> {
  let reported = false;
  const fail = (): void => {
    if (reported) return;
    reported = true;
    void reportSpawnFailure(req, ports);
  };
  return {
    onExit: (code) => {
      if (code !== 0) fail();
    },
    onError: () => fail(),
  };
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
    ports.spawn.spawnDetached('osascript', ['-e', macAppleScript(req.commandLine, req.cwd)], {
      cwd: req.cwd,
      ...failureHandlers(req, ports),
    });
    ports.notice.show('Remote Control: opening Terminal.', 8_000);
    return 'os-terminal';
  }

  if (req.platform === 'win32') {
    // `start ["title"] [/D path] command args...` - the empty title is the
    // documented placeholder so `/D` is never mistaken for one (Flint HIGH:
    // the previous build passed no `/D` and the window opened wherever `cmd`
    // itself defaulted to, never the vault). The whole tail after `/c` is
    // built as ONE string and handed to Node with `windowsVerbatimArguments`
    // so Node's own escaping never runs a second quoting pass over
    // `req.commandLine`, which `command.ts` already quoted for cmd.exe once
    // (Flint MEDIUM: two quoting layers on one string is the classic
    // cmd.exe breakage). UNVERIFIED on a real Windows machine - Knox still
    // owes that run; the reasoning and the exact argv are pinned by
    // `test/remoteControl.test.mjs` so a real run has something to confirm
    // or refute against.
    const windowsLine = `start "" /D ${quoteWindows(req.cwd)} cmd /k ${req.commandLine}`;
    ports.spawn.spawnDetached('cmd', ['/c', windowsLine], {
      cwd: req.cwd,
      windowsVerbatimArguments: true,
      ...failureHandlers(req, ports),
    });
    ports.notice.show('Remote Control: opening a command prompt.', 8_000);
    return 'os-terminal';
  }

  // Linux, best effort: only ever attempted once a terminal emulator was
  // actually found on PATH; otherwise the same clipboard fallback every
  // other route in this plugin uses when nothing else can be offered. The
  // emulator's OWN cwd (Flint HIGH, Vex M2) is what its spawned shell
  // inherits, so `cwd` rides the spawn options here rather than a shell
  // prefix on the command line.
  if (req.linuxTerminalPath) {
    ports.spawn.spawnDetached(req.linuxTerminalPath, ['-e', req.commandLine], {
      cwd: req.cwd,
      ...failureHandlers(req, ports),
    });
    ports.notice.show('Remote Control: opening a terminal.', 8_000);
    return 'os-terminal';
  }

  await ports.clipboard.writeText(req.commandLine);
  ports.notice.show('Remote Control: no terminal found to open automatically. The command is copied - paste it into a terminal.', 12_000);
  return 'clipboard';
}
