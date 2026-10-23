# Forgotten Gears — BIOS console and window system

TypeScript/Canvas implementation for the Forgotten Gears game. The console and other windows use the project's existing `IBMBios` font imported from `./fonts`. Keep your original `fonts.ts` and `web_ibm_bios-s5396Krr.woff` asset unchanged.

## Files

- `Game.ts` — window-system integration while retaining the original game loop, player movement, scene drawing, resize handling, font loading, and glow-canvas mirror. Owns the authoritative `RobotSystem` state, wires the windows, and feeds per-frame timing samples into `RobotData`.
- `Input.ts` — keyboard input with key-repeat text entry, continuous Backspace support, and mouse-wheel delta for console scrolling.
- `windows/GameWindow.ts` and `windows/WindowManager.ts` — shared interface and state-preserving window manager.
- `windows/LanguageSelectWindow.ts` — a tiny, centered language picker.
- `windows/ConsoleWindow.ts` — old-school BIOS/POST layout with a framed boot banner, aligned hardware and memory tables, module progress bars, an error log, animated diagnostic records (including failures and warnings), persistent transcript, scrollback, a text-based Y/N prompt, terminal commands, path autocompletion, and a storage meter in the header.
- `windows/CodeEditorWindow.ts` — CRT/amber Vim-style editor: file panel, command mode (`:w`, `:e`, `:new`, …), and quota-aware saves into the virtual filesystem.
- `windows/UiWindow.ts` — robot-maintenance utility panel (component registry, body schematic, power redistribution). Press `T` for the task manager.
- `windows/TaskManagerWindow.ts` — green-BIOS task manager: performance gauges (CPU load, frame time, memory, temperature, power draw, storage), a scrollable process table tied to real components, load sparklines, and the storage panel.
- `RobotData.ts` — single read-model in front of `RobotSystem` + `VirtualFileSystem`. Interface windows ask it for components, performance samples, parameters, processes, and storage instead of reaching into raw state.
- `VirtualFileSystem/` — in-memory file store shared by the console and the editor, with hard quotas (see below).
- `rasm/` — the RASM 1.0 language core (parser, compiler, device bus, virtual processor, debugger). UI-independent; see `rasm/RASM.md` for the language reference. The in-game debugger lives in `windows/RasmWindow.ts`.

## Start sequence

1. A small language window appears in the center of the screen with English pre-selected. Use Up/Down (or W/S) or hover with the mouse, then click or press Enter. `1` selects English and `2` selects Russian.
2. The BIOS console prints a long, table-formatted POST report: hardware detection, memory integrity tests, module loading, subsystem status, repeated diagnostic passes, and unresolved error codes. It automatically follows new output unless you scroll up.
3. When diagnostics finish, type `Y` and press Enter to read the operator manual, or type `N` and press Enter to skip it. This is text input; pressing the Y/N key alone does not select an answer.
4. In the terminal, type a command and press Enter.

## Console scrolling and history

- Mouse wheel scrolls the transcript.
- PageUp / PageDown scroll by approximately one screen.
- New output follows the tail unless you scroll up; while inspecting older output, new lines do not pull the view away.
- The entire console transcript is kept in memory, including startup lines, commands, answers, and command output. There is no fixed line cap.
- `clear` records a screen-clear marker but does not delete historical transcript content.
- `reboot` repeats the BIOS sequence without deleting prior logs.

## Commands

- `help` — list commands
- `status` — subsystem state
- `ui` — open robot maintenance utility
- `tasks` — open the task manager (also reachable from the utility with `T`)
- `editor` — open the Vim-style code editor
- `manual` — print the manual
- `rasm` — open the RASM debugger; `rasm check <path>` compiles a `.rasm` file and prints diagnostics
- `cat /usr/share/docs/rasm.txt` — read the RASM 1.0 language reference from the robot filesystem (also opens in `vim`)
- `clear` — append a screen-clear marker while retaining history
- `reboot` — rerun BIOS diagnostics while retaining history

### Filesystem commands

The console exposes a small shell over the shared in-memory VFS. Paths are completed with Tab.

- `ls [path]` — list a directory
- `cat <file>` — print a file
- `touch <path>` — create an empty file
- `rm <path>` — delete a session-created file (shipped system files are protected)
- `mv <from> <to>` — rename or move a session-created file
- `find <name>` — search files by name
- `df` — storage usage against the quotas

The header shows a live storage meter whenever the window is wide enough.

## Virtual filesystem quotas

Everything lives in JS memory, so the store is capped to keep a long session from growing without stalling the frame (`VFS_LIMITS` in `VirtualFileSystem/`):

- up to 48 files,
- up to 16 KB per file,
- up to 128 KB in total.

Both language variants of a file count toward the same quota. Quota violations are reported in the console and in the editor, and the storage meter/UI display the current fill level.

## Keyboard reference

- In the maintenance utility: Up/Down or 1–6 (or W/S) to select a component, Enter to inspect, `P` for power redistribution, `T` for the task manager, Escape or C to return to the console.
- In the task manager: Up/Down to scroll the process table, Escape or C to return to the console.
- The console instance remains alive while hidden, preserving its transcript and scroll position.

## Integration

Window code lives in the `windows/` directory. `GameWindow.ts`, `WindowManager.ts`, and the concrete window implementations are re-exported from there and imported by `Game.ts` as `./windows/<File>`. The bus-bypass maze puzzle and its building blocks (`WindowMaze.ts`, `MazeField.ts`, `MazeCell.ts`, `ScanWave.ts`, `GlyphRain.ts`) live in `windows/mazeComponents/`. Keep `Game.ts`, `Input.ts`, `RobotData.ts`, and `fonts.ts` in `src/game/`, and do not move the font asset.
