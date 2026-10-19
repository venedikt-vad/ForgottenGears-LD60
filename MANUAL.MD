# Forgotten Gears — Player Manual

You are an operator bringing a damaged robot back to life. Its systems are degraded,
locked, or offline. Repair every critical subsystem through the BIOS maintenance
utility, then boot the machine.

Almost everything happens in two places: the **BIOS console** (a terminal) and the
**maintenance UI** (a windowed panel with minigames). Press **C** or **Escape** in
any minigame window to return to the maintenance UI — your progress is always kept.

---

## Step 1 — Open the maintenance utility

At the console prompt, type:

```
ui
```

and press **Enter**. The robot-maintenance window opens.

- Damaged components blink **red** in the component registry.
- Use **↑ / ↓** (or **W / S**) to highlight a damaged component.
- Click **OPEN DEBUG** (or press **Enter** / **O**) to launch that component's
  repair minigame.

You can also press **1–6** to filter by body part, **0** to show all, and **P** to
jump straight to power distribution.

The **TODO** checklist in the UI tracks the five recovery tasks. All five must be
green before the robot will start.

---

## Step 2 — Reactor Core (PWR-100 / RCTR-110)

**Task: Repair the reactor.**

The reactor screen shows three concentric rings, each carrying a laser. Inside the
core there are **six activation points** — two on each laser's path.

- **Drag a ring** with the mouse to rotate it. Each ring turns its own laser.
- Aim each laser so its beam passes through both of its points. A point lights up
  when the beam crosses it.
- When **all six points are lit at once**, the reactor stabilizes (the frame turns
  green and stability locks at 100%).

The node bars on the right show per-point progress; the stability gauge on the left
climbs as more points are lit.

Press **C** or **Escape** to return to the maintenance UI.

---

## Step 3 — Power Distribution (PDU-230)

**Task: Power the motion components.**

A grid of pipe fittings sits between one power source (**IN**, on the left edge)
and five outputs on the board edges:

| Output | System | Must be |
| --- | --- | --- |
| 1 | RIGHT ARM | **OFF** |
| 2 | RIGHT LEG | **ON** |
| 3 | LEFT ARM | **ON** |
| 4 | LEFT LEG | **ON** |
| 5 | RADIO TRANSMITTER | **OFF** |

- **Click a fitting** to rotate it 90°. Only fittings connected to the live grid
  glow; power flows only through matching openings.
- Route continuous pipes from the **IN** source to outputs **2, 3 and 4**.
- Keep outputs **1 and 5** disconnected — they must stay dark.
- Each powered output draws 30% of the budget. Three online outputs = 90%. Powering
  a fourth pushes the grid **over capacity** (the frame turns red) and is never
  correct.

The puzzle is solved when the status reads **GRID STABLE** (3/5 online, 90%).

Press **C** or **Escape** to return to the maintenance UI.

---

## Step 4 — Memory Core / CPU (CPU-730 / MEM-732)

**Task: Repair the memory.**

Two tables appear side by side:

- **Left (DATA)** — a grid of lost-language glyphs.
- **Right (CHECKSUM)** — a table of numbers with a header letter on each row's
  left edge. Several cells are blanked out **red**: these are the puzzle cells.

For each red cell you must enter the correct count:

1. **Select a red cell** (click it, or move with the arrow keys).
2. On the left table, the **row and column matching that cell's header letter**
   light up. Every glyph of the header letter in that row or column turns
   **green**.
3. **Count the green glyphs** and **type the number** into the red cell.

Correct entries turn green; wrong ones stay red. Use **Backspace** to fix a
mistake. Fill in every red cell — the table locks and reads **SOLVED** when all
counts are correct.

Press **C** or **Escape** to return to the maintenance UI.

---

## Step 5 — Motion Profile Editor (MCM-740)

**Task: Repair the algorithm.**

A Vim-style editor opens over the robot's virtual file system. The motion profile
failed CRC validation and needs one command restored.

1. The file list opens on **ИНСТРУКЦИЯ** (instructions, marked `!`). The files
   above it are distractors.
2. Find the green driver file **оптимизатор_акселерации_1.0.18.DRV** — it is
   *below* the instructions, after several diagnostic files, and marked `>`.
3. **Double-click** it (or select it and press **Enter**) to open it.
4. The cursor starts on line 1. Press **↓ six times** to reach the empty **line 7**
   between the comment blocks.
5. Press **i** to enter insert mode, then type:

   ```
   RESTORE_MOTION_PROFILE()
   ```

   Letters are converted to uppercase automatically. As soon as you type the final
   parenthesis, the file is saved and a green notice appears — press **C** or
   **Escape** to return to the maintenance UI. No `:w` or `:check` needed.

Do not modify the other lines; the command must be the only executable line in the
file.

Press **C** or **Escape** to return to the maintenance UI at any time.

---

## Step 6 — Actuator Control Bus / Maze (ACT-610)

**Task: Restore the bus bypass.**

A hidden maze blocks the actuator bus. The field looks uniform until you scan it.

1. Press **Q** to emit a **scan wave** from the cursor. It reveals nearby tiles:
   walls read **red**, open passages read **green**. Scan repeatedly to map the
   safe route (up to four waves can overlap).
2. Move the **mouse** from the glowing **entrance on the left edge** toward the
   **exit on the right edge**. The route follows your cursor — no button needed.
3. Stepping on a **wall** breaks the run and the whole trail is erased; start over
   from the entrance.
4. Stepping back onto your own trail erases everything past that tile, so you can
   backtrack and take a different turn.
5. Reaching the exit solves the puzzle — the panel reads **BUS BYPASS RESTORED**.

Press **U**, **C** or **Escape** to jump back to the maintenance UI.

---

## Step 7 — Start the robot

Return to the console (press **C** or **Escape** in the maintenance UI) and type:

```
start
```

The console checks the five recovery tasks:

1. Repair the reactor
2. Power motion components
3. Restore the bus bypass
4. Repair memory
5. Repair the algorithm

If any task is incomplete, startup is refused and the blocking problems are listed.
Fix them and run `start` again. When all five are done, the robot boots and the
victory screen appears.

---

## Console commands reference

| Command | Effect |
| --- | --- |
| `help` | List available commands |
| `components` | List components and their current state |
| `status` | Summary of faults and robot mode |
| `ui` | Open the maintenance utility |
| `vim` | Open the motion-profile editor |
| `manual` | Print the operator manual |
| `clear` | Clear the console screen |
| `start` | Attempt to start the robot |

**↑ / ↓** walks through command history; **Tab** autocompletes a command.

---

## Tips

- Minigame progress is preserved if you leave and come back — a half-solved power
  grid or memory table survives a trip to the console.
- The **TODO** checklist in the UI and the `start` gate always agree; if `start`
  refuses, the same tasks are listed there.
- The blinking red rows in the component registry are exactly the components that
  still need attention. When none blink, you are ready to run `start`.
