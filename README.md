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
python3 -m pip install -r backend/requirements.txt
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

The dev server proxies `/simulate`, `/problems`, `/auth` and `/api` to `http://127.0.0.1:5001`. Set `BACKEND_URL` to use a backend on another address.

To try accounts locally without Google credentials, start the backend with `AUTH_DEV_LOGIN=1`: Sign in then logs you in as a made-up student. Never set it on a public server.

Open the local URL printed by Vite.

## Using the visualizer

1. Enter an AArch64 assembly program in the editor.
2. Select **Load** to assemble it and generate its execution history.
3. Use **Next** and **Back** to inspect individual steps, or **Run** for automatic playback.
4. Inspect the highlighted instruction, explanation, registers, and memory.
5. When the program requests input, enter it in the popup to continue.

Registers, memory, and stdout reflect the selected step. **Reset** returns to the beginning of the recorded run. After editing the source, select **Load** again.

## Challenges

The **Challenges** page (`#/problems`) is a set of graded problems. Each problem has a statement, starter code and tests. Anyone can browse and **Run** code against the visible tests; results appear under the editor. **Submit** runs every test, hidden ones included, and needs a Google sign-in: a signed-out student is taken through Google and brought back to the same problem with their code intact. A submission is **Accepted** only when every test passes. Failing hidden tests report only their number and the kind of failure: wrong answer, runtime error, exceeded instruction limit, exceeded time limit, or assembler error.

The workspace follows LeetCode's layout: the problem on the left, your code on the right, and a test console under the code that shows one visible test case at a time. After **Run**, the console opens on the first failing case and marks the register or output that differs from what was expected; **Open case N in visualizer** steps through exactly that case.

A submission opens in the left pane (`#/problems/<slug>/submissions/<id>`) while the editor and console stay where they are. It shows *Judging…* until grading finishes, then the verdict, tests passed and submission time. An accepted attempt shows its instructions and memory accesses: against the reference solution's medal bands, or as a distribution of other students' results once enough have solved the problem. A failed attempt opens on its first failing visible test and lists every test; hidden tests show only why they failed. Below that is the submitted code, with **Compare with previous attempt** (any earlier attempt can be picked), and **Open in visualizer** and **Edit and resubmit**, which puts the submitted code back in the editor. Submissions are private to their owner.

The problem's **Submissions** tab lists your attempts. The **Profile** page (`#/profile`) shows problems solved overall and by difficulty, attempted problems not yet solved, recent submissions, and the current and longest streak: consecutive days, in your own time zone, with at least one accepted submission. A streak that reached yesterday stands for the rest of today.

Signed-in drafts and progress are saved to the account. Progress made in a browser before signing in can be imported once; imported solves count in the solved record, but streaks and rankings come only from submissions graded on the server.

An accepted submission is scored by the instructions it executed and the memory accesses (loads and stores) it made over all tests, against the reference solution's totals:

| Medal | Rule |
| --- | --- |
| Gold | Both totals at most the reference's |
| Silver | Both totals at most 1.5× the reference's |
| Bronze | Any other accepted submission |

Once at least `RANKING_MIN_USERS` students (default 10) have an accepted submission on a problem, an accepted attempt also shows how it ranks: "beats X% of students" for instructions and for memory accesses separately. Each other student counts once, by their best accepted result (fewest instructions, then fewest memory accesses), and only strictly worse results count as beaten. Below the threshold the reference comparison is shown instead.

**Open in visualizer** on a visible test loads your code into the Visualizer to step through: a function problem's code comes with the grader's `main` after it, and an io problem's test input is supplied as stdin. Signed out, drafts and progress are kept in this browser's localStorage.

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

The backend tests use a throwaway SQLite database for each test and never touch `backend/data/`.

```bash
node --test src/
```

## Deploying

The app deploys as **one web service plus one database**:

- **One service.** Flask serves the API and the built frontend (`dist/`), so the session cookie is same-origin and needs no CORS. The `Dockerfile` builds both and runs gunicorn with one worker and several threads. Submissions are judged one at a time on a background thread in that worker, by the same grading worker process Run uses.
- **One database.** Accounts, sessions, submissions and drafts are stored through SQLAlchemy in the database `DATABASE_URL` names. Locally that defaults to a SQLite file in `backend/data/`. Free web hosts do not keep their disk between deploys, so production needs a hosted database: a free Postgres such as [Neon](https://neon.tech) or Supabase works. This database is the only infrastructure v2 adds.
- **Sign-in.** Google OAuth (authorization code with PKCE), done directly with the standard library. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; the database keeps only their SHA-256 hash, and Log out deletes them.

Hidden tests and reference solutions stay in `backend/problems/` on the server. A stored submission keeps only the redacted result a student may see.

To deploy, for example on Render's free web service with a Neon database:

1. In Google Cloud Console, create an OAuth client of type *Web application*. Add `https://<your-site>/auth/callback` as an authorized redirect URI (and `http://localhost:5173/auth/callback` for local development).
2. Create a Postgres database and copy its connection URL.
3. Create a web service from this repository using the `Dockerfile`, with these environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The Postgres URL (`postgres://…` is accepted) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth client |
| `PUBLIC_URL` | The site's origin, such as `https://asm-visualizer.onrender.com`. It builds the redirect URI and turns on Secure cookies. |
| `SECRET_KEY` | A long random string |
| `RANKING_MIN_USERS` | Optional; students needed before rankings show (default 10) |

Tables are created on first start. A free instance that sleeps when idle keeps nothing in memory that matters: a submission still being judged when it stopped is judged again on the next start.

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
