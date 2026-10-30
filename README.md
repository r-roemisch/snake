# Snake

A neon-arcade take on the classic snake game, built for the browser. Classic grid rules, but the snake glides smoothly between cells, the arena glows, and every bite bursts with light and sound.

**Play:** https://r-roemisch.github.io/snake/

## How to play

Steer the snake to the food. Each bite makes it one segment longer and a little faster. Hitting a wall or your own body ends the run.

| | Desktop | Phone |
| --- | --- | --- |
| Steer | Arrow keys or WASD | Swipe |
| Pause | P or Esc | Pause button |
| Mute | M | Sound button |
| Play again | Space, Enter, or any arrow key | Tap |

The snake waits, coiled up, until your first move, so you choose where to go.

### Scoring

- **Food** is worth 10 points.
- **Combo:** eat the next food quickly and your multiplier climbs, up to ×8. The meter under the multiplier shows how long you have left. You always get enough time to go straight there, plus a little slack.
- **Golden food** appears every few bites and vanishes after a few seconds; the ring around it counts down. It's worth 50 points and counts towards the combo, so a big multiplier makes it very valuable, and a slow detour can cost you the combo.
- **Perfect:** fill the whole 20×20 arena and you win, with a 10,000 point bonus.

Your high score is saved in your browser.

## Development

Requires Node 22 or newer.

```sh
npm install
npm run dev      # start a local server with hot reload
npm test         # run the tests
npm run build    # type-check and build into dist/
```

Every push to `main` runs the tests, builds the game and publishes it to GitHub Pages (see `.github/workflows/deploy.yml`).

## How it's built

TypeScript, Vite, and a single HTML canvas. There are no game or graphics libraries, and no image or sound files: everything is drawn and synthesised in the browser.

```
src/
  game/       the rules: snake, food, combos, death. No drawing, fully tested
  render/     everything visual: the gliding snake, glow, particles, screen shake
  audio.ts    synthesised sound effects (Web Audio)
  input.ts    keyboard and swipe controls
  ui.ts       score, combo meter and overlays (plain DOM)
  main.ts     the game loop that ties it together
```

The rules advance in fixed steps called ticks. The drawing runs at your screen's refresh rate and blends between the last two ticks, so movement stays smooth at 60 Hz, 120 Hz, or anything else. The words used throughout the code, such as tick, run, combo and golden food, are defined in [CONTEXT.md](CONTEXT.md).
