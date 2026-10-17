# Forgotten Gears

A 2D game built with TypeScript, HTML5 Canvas, and [Vite](https://vite.dev/).

## Requirements

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+ (Vite 8 requirement)
- npm (bundled with Node.js)

## Getting started

Install dependencies:

```bash
npm install
```

Start the dev server with hot reload:

```bash
npm run dev
```

Open the printed URL (default <http://localhost:5173>).

Controls: **WASD** or **arrow keys** to move.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally to test it |

## Project structure

```
index.html          # HTML shell with the <canvas>
public/             # Static assets copied as-is
src/
  main.ts           # Entry point, boots the game
  style.css         # Page/canvas styles
  game/
    Game.ts         # Game loop (update/render), resize handling
    Input.ts        # Keyboard input state
```

## Deploying

### itch.io

itch.io hosts HTML games from a ZIP of your built files.

1. Build the game:

   ```bash
   npm run build
   ```

   This creates the `dist/` folder. The Vite config sets `base: './'`, so all asset paths are relative and work from any subdirectory.

2. Create a ZIP containing the **contents** of `dist/` (not the `dist` folder itself). `index.html` must be at the root of the ZIP.

   PowerShell:

   ```powershell
   Compress-Archive -Path .\dist\* -DestinationPath .\forgotten-gears.zip -Force
   ```

   macOS/Linux:

   ```bash
   (cd dist && zip -r ../forgotten-gears.zip .)
   ```

3. On itch.io, create a new project, set **Kind of project** to **HTML**, and upload the ZIP.

4. Tick **"This file will be played in the browser"** and choose an embed size (e.g. `1280 x 720`). Optionally enable fullscreen.

5. Save and publish.

> Tip: keep the ZIP's `index.html` at the top level. Uploading the `dist` folder itself will result in a blank page.

### GitHub Pages

1. In `vite.config.ts`, keep `base: './'` for a root/user page. For a project page it also works, but if you prefer an absolute path use `base: '/<repo-name>/'`.
2. Build with `npm run build`.
3. Publish the `dist/` folder, e.g. using the [`gh-pages`](https://www.npmjs.com/package/gh-pages) package:

   ```bash
   npx gh-pages -d dist
   ```

4. In the repo settings, set Pages to serve from the `gh-pages` branch.

### Netlify / Vercel / Cloudflare Pages

These platforms build automatically:

- **Build command:** `npm run build`
- **Output/publish directory:** `dist`

### Any static host

Run `npm run build` and upload the contents of `dist/` to any static file host.
