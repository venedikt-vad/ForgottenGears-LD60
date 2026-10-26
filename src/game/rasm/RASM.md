# RASM 1.0 — Robot Assembly

RASM is the small assembly-like language the robots in *Forgotten Gears* are
programmed in. It is deliberately tiny: eight registers, 256 words of RAM, a
handful of instructions and a device bus. Everything here is implemented in
`src/game/rasm/` and is free of any UI or browser dependency — the same core
runs under Node in tests and inside the game's canvas window.

## 1. Source format

- One instruction per line.
- `;` starts a comment and runs to the end of the line.
- Blank lines (and lines that are only a comment) are ignored, but **line
  numbers are preserved**: a diagnostic always points at the line you wrote.
- Mnemonics, register names, labels and device names are **case-insensitive**
  (`mov`, `MOV` and `Mov` are the same instruction).
- Operands are separated by **commas**, not spaces:
  `MOV R0, #5` (two operands), not `MOV R0 #5`.
- `LABEL:` may sit on its own line or in front of an instruction:

  ```asm
  START:  MOV R0, #1     ; label and instruction on one line
  DONE:                  ; label on its own line
          HALT
  ```

  Several labels may precede one instruction (`A: B: HALT`).

## 2. Machine model

| Resource | Size | Notes |
| --- | --- | --- |
| Registers | `R0`–`R7`, 16-bit unsigned | 8 general-purpose registers |
| RAM | 256 cells, 16 bits each | addressed `0x00`–`0xFF` / `0`–`255` |
| Program counter | instruction index | visible in the debugger as `PC` |
| Comparison flag | `=`, `<`, `>` | set by `CMP`, read by the conditional jumps |

All arithmetic is **modulo 65536** (16-bit wrap-around). There are no negative
values; a comparison is an unsigned comparison.

## 3. Operand forms

| Form | Example | Meaning |
| --- | --- | --- |
| Register | `R3` | one of `R0`–`R7` (index 0–7) |
| Immediate | `#80`, `#0x50` | a literal 16-bit value, `0`–`65535` |
| Address | `[0x20]`, `[32]` | a RAM cell, `0`–`255` |
| Label | `OVERHEAT` | a jump target, resolved at compile time |
| Device | `TEMP`, `MOTOR` | a port name handed to the device bus |

Numbers are decimal (`80`) or hexadecimal with a `0x`/`0X` prefix (`0x50`).
Signs are not accepted; `12abc` and `#` are reported as errors rather than
silently truncated.

## 4. Instruction set

| Instruction | Operands | Effect |
| --- | --- | --- |
| `NOP` | — | Do nothing for one tick. |
| `MOV dst, src` | `R`, `R`/`#` | Copy `src` into `dst`. |
| `LOAD dst, [addr]` | `R`, `[ ]` | Read the RAM cell into `dst`. |
| `STORE [addr], src` | `[ ]`, `R` | Write register `src` into the RAM cell. |
| `ADD dst, src` | `R`, `R`/`#` | `dst = (dst + src) mod 65536`. |
| `SUB dst, src` | `R`, `R`/`#` | `dst = (dst - src) mod 65536`. |
| `CMP a, b` | `R`, `R`/`#` | Set the comparison flag from `a` vs `b` (unsigned). |
| `JMP label` | label | Unconditional jump. |
| `JE label` | label | Jump when the last `CMP` was **equal**. |
| `JNE label` | label | Jump when the last `CMP` was **not equal**. |
| `JGT label` | label | Jump when `a > b`. |
| `JGE label` | label | Jump when `a >= b`. |
| `JLT label` | label | Jump when `a < b`. |
| `JLE label` | label | Jump when `a <= b`. |
| `IN dst, DEVICE` | `R`, device | Read a value from a device port into `dst`. |
| `OUT DEVICE, src` | device, `R`/`#` | Send a value to a device port. |
| `HALT` | — | Stop the program (normal end). |

`MOV`, `ADD`, `SUB` and `CMP` accept an immediate **or** a register as the
second operand. `LOAD`/`STORE` are the only RAM instructions and use the
`[address]` form.

### Conditional jumps require `CMP`

A conditional jump (`JE`, `JNE`, `JGT`, `JGE`, `JLT`, `JLE`) that runs before
any `CMP` has executed is a **runtime error** (`COMPARE_NOT_SET`), never a
silent “not taken”. Reset clears the flag, so the first branch after a reset
must be preceded by a `CMP`.

## 5. Labels

- A label matches `[A-Za-z_][A-Za-z0-9_]*` followed by `:`.
- Labels resolve to an **instruction index**, not a source line.
- Two labels with the same name are a `DUPLICATE_LABEL` error.
- A jump to a missing label is an `UNKNOWN_LABEL` error.

## 6. Devices

Devices live behind a bus, so the language itself has no built-in hardware:
`TEMP` and `MOTOR` are **level names**, not keywords. Any port that is not
connected produces a `DEVICE_READ_ERROR` / `DEVICE_WRITE_ERROR` at run time.

The demo level wires two ports:

| Port | Direction | Value |
| --- | --- | --- |
| `TEMP` | read | Temperature in degrees Celsius. Warms while the motor runs, cools when it is idle. |
| `MOTOR` | read/write | `0` = stop, `1..1000` = speed. |

Each executed instruction advances the sim by one tick, which is what makes the
temperature drift over time.

## 7. Execution model

- The processor executes one instruction per `step()`.
- `run(budget)` executes until `HALT`, a fault, the end of the program, or the
  **instruction budget** is exhausted. The budget is the guard against infinite
  loops: exceeding it stops with `STEP_BUDGET_EXCEEDED` instead of freezing.
- Running off the end of the program is a normal stop, not a fault.
- A **compile error prevents running**: the processor refuses to load a program
  with diagnostics.

## 8. Errors

Every problem is a `Diagnostic` with a stable `code`, a human message, a source
line and, when known, a column. Parse/compile errors come from the compiler;
runtime errors come from the processor.

| Code | Phase | Meaning |
| --- | --- | --- |
| `UNKNOWN_INSTRUCTION` | parse | Mnemonic is not in the ISA. |
| `BAD_ARGUMENT_COUNT` | compile | Wrong number of operands. |
| `BAD_OPERAND` | parse/compile | Operand has the wrong shape for its slot. |
| `BAD_NUMBER` | parse | Not a valid number, or out of 16-bit range. |
| `BAD_REGISTER` | parse | Register outside `R0`–`R7`. |
| `BAD_ADDRESS` | parse | RAM address outside `0`–`255`, or missing `]`. |
| `TRAILING_TEXT` | parse | Extra text after the operands. |
| `EMPTY_OPERAND` | parse | Empty operand between commas. |
| `DUPLICATE_LABEL` | compile | A label is declared twice. |
| `UNKNOWN_LABEL` | compile | A jump target is not declared anywhere. |
| `INVALID_LABEL` | parse | A label name violates the identifier rule. |
| `UNKNOWN_DEVICE` | runtime | Port is not connected. |
| `DEVICE_READ_ERROR` | runtime | A read from a port failed. |
| `DEVICE_WRITE_ERROR` | runtime | A write to a port failed. |
| `COMPARE_NOT_SET` | runtime | Conditional jump before any `CMP`. |
| `INVALID_RAM_ACCESS` | runtime | RAM access outside `0`–`255`. |
| `PROCESSOR_HALTED` | runtime | Instruction after `HALT`/fault. |
| `STEP_BUDGET_EXCEEDED` | runtime | Run hit the instruction budget. |
| `PROGRAM_NOT_LOADED` | runtime | No program was loaded. |

## 9. Example — thermal governor

The shipped example (`public/rasm/thermal_governor.rasm`, also seeded in the
in-game filesystem at `/opt/firmware/motion/thermal_governor.rasm`) reads the
temperature and ramps the motor until it gets too hot:

```asm
        MOV R0, #0          ; R0 = motor speed
        MOV R1, #80         ; R1 = temperature limit
        MOV R2, #0x20       ; R2 = scratch address in RAM

LOOP:   IN  R3, TEMP        ; read the thermal sensor
        CMP R3, R1          ; compare with the limit
        JGE OVERHEAT        ; hot enough? stop

        ADD R0, #10         ; ramp speed up
        OUT MOTOR, R0       ; command the motor
        STORE [0x20], R0    ; remember the last speed
        JMP LOOP

OVERHEAT:
        OUT MOTOR, #0       ; cut the motor
        LOAD R4, [0x20]     ; R4 = last speed reached
        HALT
```

## 10. Using it in the game

Type `rasm` in the console to open the RASM debugger. The window compiles the
buffer as you go and shows source, registers, RAM, `PC`, ticks, the comparison
flag, device values and diagnostics.

| Key | Action |
| --- | --- |
| `F5` / `R` | Run (with an instruction budget). |
| `F8` / `S` | Step one instruction. |
| `F9` / `G` | Reset the machine and the level. |
| `F10` / `B` | Toggle a breakpoint on the current source line. |
| `C` | Recompile and report. |
| `M` | Switch between the demo test bench and the robot's real hardware. |
| `Tab` | Switch between the source and machine panes. |
| `↑` / `↓` | Move the source cursor. |
| `PgUp` / `PgDn` | Move the source cursor by one page. |
| `Esc` / `Q` | Leave the window. |

The same language reference is shipped inside the robot filesystem, so it is
available during the game without the repository:

```text
cat /usr/share/docs/rasm.txt
vim /usr/share/docs/rasm.txt
```

The editor's `:help` panel lists its commands and points at that file;
`:help rasm` opens it directly. The console `help` and `manual` commands also
print the path.

Every service process of the robot (the rows of the task manager) has a real
RASM source under `/sys/services`, named after the process. Open the task
manager, select a service and press `E` (or Enter) to read and edit its script
in the editor; `:w` saves it into the session filesystem. The same files are
reachable from the shell:

```text
ls /sys/services
cat /sys/services/fg.thermal.prot.rasm
vim /sys/services/fg.thermal.prot.rasm
```

From the console you can also check a file without opening the window:

```
rasm check /opt/firmware/motion/thermal_governor.rasm
```

The editor's `:check` command compiles `.rasm` files through the same core, so
the diagnostics you see in the editor and in the debugger are identical.
