# claude-shift

Optimize your Claude Max 5-hour usage slots by scheduling strategic session pings. Pre-burn slots during idle hours (sleep, commute, office) so fresh slots align with your actual working hours.

## Why?

Claude Max gives you 5-hour usage windows. When a slot ends, a new one is available immediately. But if you just start working whenever, your slot boundaries land randomly — you might hit a slot expiry mid-flow.

**claude-shift** lets you control when slots start and end by pinging Claude at strategic times. A ping during sleep burns through a slot so it expires right when you wake up, giving you the tail of the expiring slot *plus* a fresh one for extended continuous coverage.

## Example

Say you work 6:30–8am, 9–11am, and 8–11pm on weekdays:

```
$ claude-shift smart --slots "06:30-08:00,09:00-11:00,20:00-23:00" --days weekdays

Smart mode calculation:
  Slot duration: 5h | Burn rate: 2h

  Your work windows:
    6:30am – 8am on weekdays
    9am – 11am on weekdays
    8pm – 11pm on weekdays

  Calculated pings:
    Ping at 01:30 → slot runs 01:30–06:30 → fresh slot at 06:30
    Ping at 04:00 → slot runs 04:00–09:00 → fresh slot at 09:00
    Ping at 15:00 → slot runs 15:00–20:00 → fresh slot at 20:00

✓ 3 smart trigger(s) configured.
```

Visual timeline:

```
  Schedule Timeline

      00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
      |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
  Mon    ⚡──────⚡──────────────                  ⚡──────────────
                       ████   ██████                           █████████
  Tue    ⚡──────⚡──────────────                  ⚡──────────────
                       ████   ██████                           █████████

  ⚡ ping  ─ slot (5h)  █ work window
```

## Install

```bash
npm install -g claude-shift
```

Requires Node.js 18+ and [Claude CLI](https://claude.ai/download) installed.

## Quick start

Interactive setup:

```bash
claude-shift init
```

This walks you through configuring your work hours, detects your Claude CLI, and registers pings with your OS scheduler.

## Usage

### Smart mode (recommended)

Tell claude-shift when you work, it calculates optimal ping times:

```bash
claude-shift smart --slots "08:00-13:00,20:00-23:00" --days weekdays
```

Options:
- `-s, --slots` — Your work windows (HH:mm-HH:mm, comma-separated)
- `-d, --days` — Days to apply (`weekdays`, `weekends`, `daily`, `mon-fri`, `mon,wed,fri`)
- `-b, --burn-rate` — How long a slot typically lasts for you in hours (default: 2)

### Manual mode

Specify exact ping times:

```bash
claude-shift add 03:00 --days weekdays
claude-shift add 16:30 --days mon,wed,fri
```

### Activate

After configuring triggers, register them with your OS scheduler:

```bash
claude-shift install
```

This uses the native scheduler for your platform:
- **Windows** — Task Scheduler (`schtasks`)
- **macOS** — launchd (plist in `~/Library/LaunchAgents`)
- **Linux** — cron (`crontab`)

### View your schedule

```bash
claude-shift today    # Today's timeline
claude-shift week     # Full week view
claude-shift list     # All configured triggers
claude-shift status   # Scheduler status + recent ping logs
```

### Manage triggers

```bash
claude-shift remove shift-001   # Remove a trigger by ID
claude-shift uninstall          # Remove all from OS scheduler
```

### Test a ping

```bash
claude-shift run    # Fire a ping right now
```

## How it works

1. **You configure** when you want to work (smart mode) or when to ping (manual mode)
2. **claude-shift calculates** optimal ping times by working backwards from your schedule
3. **Your OS scheduler** fires the pings at the right times
4. **Each ping** opens an interactive Claude session via a pseudo-TTY, sends a message, and exits
5. **The session starts** a 5-hour slot that burns during your idle time
6. **When you sit down** to work, a fresh slot is ready

## Configuration

Config is stored at `~/.claude-shift/config.json`. Ping logs are at `~/.claude-shift/ping.log`.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `slotDuration` | 5 | Claude Max slot duration in hours |
| `burnRate` | 2 | How long a slot typically lasts for you |
| `claudePath` | `claude` | Path to Claude CLI |
| `pingMessage` | `ping` | Message sent to start the session |

## Platform notes

### Windows
Tasks run "only when user is logged on". For overnight pings (e.g., 3am), your machine needs to be awake and logged in. Consider disabling sleep or using wake timers.

### macOS
launchd handles wake-from-sleep scheduling natively. Pings will fire even if your Mac was asleep at the scheduled time (it fires on next wake).

### Linux
cron entries use absolute paths to avoid PATH issues in the cron environment.

## License

MIT
