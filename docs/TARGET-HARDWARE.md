# Measuring Puntovivo on the target till

**Language:** English · [Español](./es/TARGET-HARDWARE.md)

The budgets in [`PERF-BUDGETS.md`](./PERF-BUDGETS.md) were captured on an
Apple M4 and on hosted CI runners. This guide measures a packaged build on the
till Puntovivo targets: an Intel Celeron J1900 with 4 GB of RAM running
Windows 10 22H2. Microsoft ended general support for Windows 10 in October
2025; the operational pilot accepts that version anyway.

The harness lives in `scripts/target-hardware/`:

| File                    | What it does                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `Measure-Puntovivo.ps1` | Installs a build, measures startup, sales and an 8-hour soak, and judges the run against U1 to U8. |
| `Compare-Runs.ps1`      | Compares the runs of two builds, using a repeat of the first build as the noise level.             |

Both run on the Windows PowerShell 5.1 that ships with Windows 10 and need no
extra modules.

## What you need

- The J1900 till, its keyboard and barcode scanner, and the receipt printer if
  the shop has one.
- A USB stick to bring the results back.
- About 10 hours per build. You are needed for about one hour; the 8-hour soak
  runs alone, so start it in the evening.
- Two downloads, saved in `C:\pv-measure\`:
  - The Windows installer of the build to measure, for example
    `Puntovivo-1.17.1-win-x64.exe`, from the release page on GitHub or from
    the `desktop-win-<sha>` artifact of a Build Desktop (manual) run.
  - `Measure-Puntovivo.ps1` and `Compare-Runs.ps1` from
    `scripts/target-hardware/` on GitHub. Open each file and use Download raw
    file.

## Prepare the till once

1. Install the pending Windows updates and the latest Intel graphics driver,
   then restart. The harness records the driver version, disk type, page file
   and antivirus by itself, so you do not have to write them down.
2. Leave the till as it will be in the shop: same antivirus, same screen
   resolution, page file managed by the system. In an ordinary Command Prompt
   or PowerShell window, choose High performance and turn off sleep and the
   screen timeout:

   ```powershell
   powercfg /setactive SCHEME_MIN
   powercfg /change standby-timeout-ac 0
   powercfg /change monitor-timeout-ac 0
   ```

3. Keep Windows quiet while you measure:
   - Settings, Update and Security, Windows Update: Pause updates for 7 days,
     so nothing installs or restarts the till during a soak.
   - Settings, System, Focus assist: Alarms only, so no notification takes the
     focus away from Puntovivo.
   - Close every other program and do not use the till while a phase runs.
4. Allow the two scripts once, in a PowerShell window opened as your usual
   user:

   ```powershell
   cd C:\pv-measure
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   Unblock-File .\Measure-Puntovivo.ps1, .\Compare-Runs.ps1
   ```

5. Install the build:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase install -Installer .\Puntovivo-1.17.1-win-x64.exe
   ```

6. Open Puntovivo from the Start menu and set it up like the shop: create the
   company, import the shop catalog (or at least 2,000 products), give the
   products you will scan enough stock for a few hundred sales, and open the
   cash register. Leave electronic invoicing off, as in the operational pilot,
   and leave the tray option that hides the window on close turned off.
7. Write `C:\pv-measure\barcodes.txt` with at least 20 barcodes of products
   from that catalog, one per line. Use products sold by unit: no weighed
   products, lots or serial numbers, and codes of 6 characters or more,
   because the scanner listener ignores shorter input. The catalog CSV works
   too if it has a `barcode` column.
8. Close Puntovivo, from the tray icon as well, and save this data as the
   baseline every run starts from:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase baseline -Baseline C:\pv-measure\baseline.zip
   ```

   The data folder is `%APPDATA%\Puntovivo`. Restoring it only works for the
   same Windows user on the same till, because Windows protects the database
   key for that user.

## Measure one build

Give every run its own label, for example `v1.17.1`, and `v1.17.1-b` for a
repeat of the same build.

1. Install the build and restore the baseline. The current data folder is
   moved aside next to it, not deleted.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase install -Installer .\Puntovivo-1.17.1-win-x64.exe -Baseline C:\pv-measure\baseline.zip
   ```

2. Restart Windows, sign in, and wait 5 minutes without touching anything.
3. Startup, about 10 minutes. Puntovivo opens three times. Each time, sign in
   when the login screen appears; the harness notes when the login screen
   became usable and when the point of sale opened, then closes Puntovivo.
   Run 1 is the cold start.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase startup -Label v1.17.1
   ```

4. Sales, about 30 minutes. Sign in when Puntovivo opens, then sell as you
   would in the shop: scan 5 products, press `F2` for exact cash and confirm.
   Each sale is timed from its first scan until the charge closes. Ring up 10
   sales, wait 2 minutes, then ring up 10 more.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase sales -Label v1.17.1
   ```

5. Backup during sales, in the same phase. Click the PowerShell window and
   press `B`, go to Company in Puntovivo and click Create Backup in the local
   database backup card, then at once try to scan and to move the window. When the backup finishes, click the
   PowerShell window and press `B` again. Press `Q` to end the phase;
   Puntovivo stays open.
6. Soak, 8 hours. Leave Puntovivo in front on the sales screen and start:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase soak -Hours 8 -Drive -Barcodes C:\pv-measure\barcodes.txt -Label v1.17.1
   ```

   The simulated cashier sells once a minute: 3 to 6 codes typed like a
   scanner, `F2` and Enter. Do not use the till until it ends. If something
   covers Puntovivo, the cashier brings it back to the front; if that keeps
   failing, it continues through the DevTools connection, which only reaches
   Puntovivo, and notes the switch.

7. The harness prints the verdict when each phase ends. Copy the whole folder
   `C:\pv-measure\runs\v1.17.1\` to the USB stick and bring it back. It holds
   measurements and details of the till, not shop sales data.

While a phase runs, Puntovivo is started with a DevTools port open on
`127.0.0.1` only, so the harness can read the screen state and time the
renderer, and with automatic updates off, so the build cannot change in the
middle of a run.

## Compare two builds

1. Same till, same Windows user, the same day if possible, and nothing new
   installed between runs.
2. Measure build A, then build B, then A again with another label. The second
   A measures how much the till itself varies.
3. Compare:

   ```powershell
   .\Compare-Runs.ps1 -A C:\pv-measure\runs\v1.17.1 -B C:\pv-measure\runs\v1.18.0 -Noise C:\pv-measure\runs\v1.17.1-b
   ```

`compare.md` lands in the B folder with one row per metric: A, B, difference,
percent and verdict. A difference smaller than the A-to-A noise, or under
10 % and 20 MB, is no change. B is a regression when it is worse by more than
10 % and 20 MB (memory) or 15 % (times), or when any threshold goes from PASS
to FAIL. `compare-curves.csv` holds the main and GPU working set minute by
minute for both soaks: a different slope matters more than the final value.

Keep the run folders outside the repository. Only the summary and the final
thresholds belong in it.

## Thresholds

These are starting points. After the first run on the till, fix the final
values in `perf-budget.json` under a new `targetHardware` key.

| Rule | Check            | Fails when                                                                                                                                                 |
| ---- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | GPU plus utility | The GPU and utility working sets add up to more than 1,024 MB, averaged over the last 10 minutes of the soak.                                              |
| U2   | Paging in a sale | Inside any sale, page reads stay above 20 per second for 2 seconds or more, or free memory drops under 150 MB. With an SSD, 50 per second is a fair limit. |
| U3   | Leak             | In a soak of 2 hours or more, any process grows faster than 10 MB per hour from hour 1, or private memory ends above 1.5 times its hour-1 value.           |
| U4   | Total memory     | All Puntovivo processes together use more than 1,600 MB at any moment.                                                                                     |
| U5   | Sale time        | The median sale takes more than 3 seconds or the 95th percentile more than 6. Simulated sales are used when there are any; manual times include scanning.  |
| U6   | Startup          | The cold start takes more than 45 seconds to a usable login, or the median warm start more than 20.                                                        |
| U7   | Backup freeze    | Between the two `B` presses, the renderer stalls or an IPC round trip takes more than 1 second.                                                            |
| U8   | Stability        | During the soak Puntovivo closes, or the GPU process restarts.                                                                                             |

Each verdict is PASS, FAIL or SKIP; a rule is skipped when its phase did not
run.

## What a run folder holds

| File           | Contents                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `samples.csv`  | Working set, private memory, CPU, handles, threads and GPU memory of every process, per sample. |
| `system.csv`   | Free memory, committed memory, page reads, page file, disk queue and total CPU, every second.   |
| `renderer.csv` | IPC round trip percentiles, renderer lag, JavaScript heap and DOM size, per sample.             |
| `sales.csv`    | One row per sale: duration, time to charge, lines and status.                                   |
| `startup.csv`  | One row per launch: login usable, point of sale ready, close time.                              |
| `markers.csv`  | Launches, backups, notes, focus changes and process exits.                                      |
| `meta.json`    | Build, till, Windows, driver, disk, page file and graphics tier.                                |
| `summary.json` | The figures `Compare-Runs.ps1` reads and every verdict.                                         |
| `verdict.md`   | The verdict table.                                                                              |

The harness exits with 0 when every judged rule passed, 1 when one failed and
2 when it could not measure. To judge a run again, for example after an
interruption or a threshold change, run
`.\Measure-Puntovivo.ps1 -Phase summarize -RunDir C:\pv-measure\runs\v1.17.1`.
To repeat one phase of a run, add `-Force` to that phase.

## Troubleshooting

- "Puntovivo is already running": close it from the tray icon too, then run
  the phase again. The soak can attach to the Puntovivo the sales phase left
  open, but not to one started from the Start menu.
- "cannot be loaded because running scripts is disabled": repeat step 4 of the
  preparation.
- `focus_lost` or `input_fallback` in `markers.csv`: something covered
  Puntovivo during the soak. The run still counts; check what it was.
- `scan_miss` in `markers.csv`: that barcode did not add a product. Remove it
  from `barcodes.txt`.

## Self-test in CI

Build Desktop (manual) has a `harness` input. With `win` and `harness` on and
`validate_only` off, a Windows job installs the build artifact with the
harness and runs it in short mode under Windows PowerShell 5.1: two startups,
a 4-minute soak with the simulated cashier, and a comparison. The run folder
is uploaded as `target-hardware-selftest-<sha>`. That job uses `-TestProfile`,
which seeds the demo data into a throwaway profile and starts Puntovivo with
`PUNTOVIVO_E2E=1`, a throwaway `PUNTOVIVO_DB_KEY`, `--user-data-dir` and a free
`PUNTOVIVO_BIND_PORT`. Never use `-TestProfile` on the till you measure.
`scripts/target-hardware-harness.test.mjs` runs both scripts on synthetic
runs in the release automation job.
