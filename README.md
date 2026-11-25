# AArch64 Assembly Visualizer

An interactive tool for learning AArch64 assembly, designed around Princeton’s COS 217 course.

Write assembly, execute it one instruction at a time, and see how each instruction changes registers and memory. Step backward to revisit earlier states, inspect recursive function calls, and follow programs that allocate memory or interact with the user.

## Features

- **Execution controls:** Load, step forward and backward, reset, or run automatically with adjustable playback speed.
- **Code tracking:** Highlight the executed instruction and scroll to keep it visible.
- **Instruction explanations:** Explain the instruction alongside the state it produced.
- **Registers:** Inspect general-purpose registers, SP, PC, and condition flags, with changed values highlighted.
- **Stack frames:** Group stack memory by function call, including recursive calls.
- **Heap:** Visualize allocations and writes, and watch blocks disappear when freed.
- **Memory sections:** Inspect `.data`, `.bss`, and `.rodata`, including labels and stored contents.
- **Input and output:** Read input through a popup and view stdout alongside execution.
- **Display formats:** Choose hexadecimal or decimal representations for addresses and data.

## Getting started

### Requirements

- Python 3
- Node.js and npm
- Flask, Keystone Engine, and Unicorn Engine

Install the backend dependencies:

```bash
python3 -m pip install flask keystone-engine unicorn
```

Install the frontend dependencies from the project root:

```bash
npm install
```

### Start the backend

From the project root:

```bash
cd backend
python3 -m flask --app app run --port 5001 --debug
```

### Start the frontend

In another terminal, from the project root:

```bash
npm run dev
```

The dev server proxies `/simulate` and `/problems` to `http://127.0.0.1:5001`. Set `BACKEND_URL` to use a backend on another address.

Open the local URL printed by Vite.

## Using the visualizer

1. Enter an AArch64 assembly program in the editor.
2. Select **Load** to assemble it and generate its execution history.
3. Use **Next** and **Back** to inspect individual steps, or **Run** for automatic playback.
4. Inspect the highlighted instruction, explanation, registers, and memory.
5. When the program requests input, enter it in the popup to continue.

Registers, memory, and stdout reflect the selected step. **Reset** returns to the beginning of the recorded run. After editing the source, select **Load** again.

## Challenges

The **Challenges** page (`#/problems`) is a set of graded problems. Each problem has a statement, starter code and tests. **Run** checks your code against the visible tests; **Submit** runs every test, hidden ones included. A submission is **Accepted** only when every test passes. Failing hidden tests report only their number and the kind of failure: wrong answer, runtime error, exceeded instruction limit, exceeded time limit, or assembler error.

An accepted submission is scored by the instructions it executed and the memory accesses (loads and stores) it made over all tests, against the reference solution's totals:

| Medal | Rule |
| --- | --- |
| Gold | Both totals at most the reference's |
| Silver | Both totals at most 1.5× the reference's |
| Bronze | Any other accepted submission |

**Open in visualizer** on a visible test loads your code into the Visualizer to step through: a function problem's code comes with the grader's `main` after it, and an io problem's test input is supplied as stdin. Drafts, solved status and the best medal are kept in this browser's localStorage; there are no accounts.

### Adding a problem

Each problem is a folder in `backend/problems/`, named for its slug:

| File | Contents |
| --- | --- |
| `problem.json` | `title`, `slug`, `difficulty` (`easy`, `medium` or `hard`), `tags`, `kind` (`io` or `function`), optional `limits` (`instructions`, at most 10,000, and `seconds`), and for a function problem `function`: its `name`, `signature`, `args` (each a `name` and a `type`: `long`, `int`, `long[]` or `char*`) and `returns` (`long`, `int` or `void`) |
| `statement.md` | The problem text, with examples. Headings, paragraphs, lists, code fences, `code`, **bold** and *emphasis* are rendered. |
| `starter.s` | The code the editor starts with |
| `tests.json` | A list of `{"id", "visible", "input", "expected"}` |
| `reference.s` | The reference solution. It is never sent to the browser. |

An **io** test's `input` is the stdin text and `expected` the exact stdout. A **function** test's `input` maps each argument name to its value, and `expected` holds `x0` and/or `memory`, the expected final contents of `long[]` arguments. The grader adds a `main` that sets `x19`–`x28` to known values, puts the arguments in `x0`–`x7` (arrays and strings in `.data`), calls the function and returns; `x19`–`x28` and `sp` must be unchanged afterwards. Only instructions on the student's own lines are counted.

Problems are validated when the backend starts, and every reference solution is run against its tests. A malformed problem, or a reference that fails, stops the backend with an error naming the file.

## Tests

```bash
cd backend && python3 -m unittest
```

```bash
node --test src/
```

## Supported library functions

The visualizer simulates a small set of library functions:

| Purpose | Functions |
| --- | --- |
| Heap allocation | `malloc`, `free` |
| Output | `printf`, `puts`, `putchar` |
| Input | `getchar`, `fgets`, `scanf` |

`printf` supports literal text, `%%`, `%d`, `%u`, `%ld`, `%lu`, `%c`, `%s`, and `%p`.

`scanf` supports one `%d` or `%ld` conversion.

For `fgets`, pass the buffer address in `x0`, its size in `w1`, and `0` in `x2` to select simulated stdin.

These functions are simulated by the backend; the project does not load or execute a full C standard library.

## How it works

The frontend sends assembly source to a Python backend.

- **Keystone** assembles instructions into machine code.
- **Unicorn** executes ordinary machine instructions.
- **Python** manages memory, records execution states, and handles supported library calls.
- **React** displays the recorded states and provides playback controls.

Memory is divided into text, stack, heap, and static data sections. Section permissions prevent writes to read-only memory.

When input is needed, history generation pauses. After input arrives, the backend reconstructs execution using the saved source and input events, and the frontend extends the existing history.

## Scope and limitations

This is an educational assembly simulator, with support focused on the COS 217 instruction set and examples. It is not a complete operating system or a general-purpose AArch64 environment.

- Assembly input only.
- Limited library support; no file I/O or arbitrary external functions.
- No floating-point formatting or full `printf`/`scanf` syntax.
- Execution is limited to 10,000 instruction steps.
- The simulated heap is 16 KiB.
- Input and output each have a 1 MiB limit.
- Strings and input/output operate on UTF-8 bytes.
- Memory checks detect several invalid accesses but cannot identify every pointer or buffer error.

## Development checks

Run backend tests from the project root:

```bash
python3 -B -m unittest discover -s backend
```

Run frontend tests and checks:

```bash
node --test src/history.test.js
npm run lint
npm run build
```

On Apple Silicon Macs, Keystone may require the Homebrew library path:

```bash
export DYLD_LIBRARY_PATH=/opt/homebrew/opt/keystone/lib
```

## Project context

Developed as a Princeton independent work project to help students connect AArch64 instructions with changes in registers, memory, and function calls.
