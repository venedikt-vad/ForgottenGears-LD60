# Forgotten Gears — BIOS console and window system

TypeScript/Canvas implementation for the Forgotten Gears game. The console and other windows use the project's existing `IBMBios` font imported from `./fonts`. Keep your original `fonts.ts` and `web_ibm_bios-s5396Krr.woff` asset unchanged.

## Files

- `Game.ts` — window-system integration while retaining the original game loop, player movement, scene drawing, resize handling, font loading, and glow-canvas mirror.
- `Input.ts` — keyboard input with key-repeat text entry, continuous Backspace support, and mouse-wheel delta for console scrolling.
- `windows/GameWindow.ts` and `windows/WindowManager.ts` — shared interface and state-preserving window manager.
- `windows/LanguageSelectWindow.ts` — a tiny, centered language picker.
- `windows/ConsoleWindow.ts` — old-school BIOS/POST layout with a framed boot banner, aligned hardware and memory tables, module progress bars, an error log, 168 animated diagnostic records (including failures and warnings), persistent transcript, scrollback, a text-based Y/N prompt, and terminal commands.
- `windows/UiWindow.ts` — robot-maintenance utility panel.

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
- `manual` — print the manual
- `clear` — append a screen-clear marker while retaining history
- `reboot` — rerun BIOS diagnostics while retaining history

In the maintenance utility, use Up/Down or 1–4 to select a component and Enter to inspect it. Press Escape or C to return to the console. The console instance remains alive while hidden, preserving its transcript and scroll position.

## Integration

Window code lives in the `windows/` directory. `GameWindow.ts`, `WindowManager.ts`, and the concrete window implementations are re-exported from there and imported by `Game.ts` as `./windows/<File>`. The bus-bypass maze puzzle and its building blocks (`WindowMaze.ts`, `MazeField.ts`, `MazeCell.ts`, `ScanWave.ts`, `GlyphRain.ts`) live in `windows/mazeComponents/`. Keep `Game.ts`, `Input.ts`, and `fonts.ts` in `src/game/`, and do not move the font asset.
