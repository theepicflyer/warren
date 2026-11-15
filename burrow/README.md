# Burrow in Warren

Burrow is the household's design system. Its source of truth is a Claude Design artifact, the
Burrow design system (https://claude.ai/artifact/ShL86DzdjvTZDwRHLsd8L4). Whoever owns Burrow
decides how it looks there. Warren only hosts it, so that Bao and Cache draw it from one place:

- `export/` holds the artifact's files exactly as they are published, at the same paths they
  have under the artifact's `project/` folder:
  - `README.md`: the brand book (principles, the cast, where information goes, voice);
  - `tokens.json`: the tokens;
  - `components/bundle.css`: the `bh-*` component classes;
  - `components/bundle.js`: the React components and the SVG string generators;
  - `components/index.d.ts`: their types.

  Never edit these files. When Burrow changes, copy them again.
- `generate.cjs` turns them into what the apps import (`src/burrow/generated/`, also never
  edited by hand). It has no dependencies:
  - `tokens.css`: the tokens as CSS variables, light by default and dark with the device, or
    pinned with `html[data-theme="light"]` / `html[data-theme="dark"]`;
  - `type.css`: the text styles as classes;
  - `burrow.css`: `bundle.css` without its Google Fonts import (the apps bundle their fonts);
  - `art.js` and `art.d.ts`: the bundle's SVG string generators as an ES module, without its React
    components;
  - `scenes.ts`: the fund's stash and the month's wreath, rendered from the bundle's `Stash` and
    `Ring` for every count.

The Svelte components in `src/burrow/` are Warren's own ports of Burrow's components. They draw
with Burrow's classes and art and can change. The look itself only changes by re-syncing.

## Re-sync from the artifact

1. Read the artifact's files. An agent with the Artifact tool reads them with
   `action: "read"`, the artifact's URL, and `paths`: `project/README.md`,
   `project/tokens.json`, `project/components/bundle.css`, `project/components/bundle.js` and
   `project/components/index.d.ts`. A person can download them from the artifact's page.
2. Copy each one over its namesake in `burrow/export/`, with the `project/` prefix dropped
   (`project/components/bundle.js` goes to `burrow/export/components/bundle.js`).
3. Regenerate and check:

   ```bash
   npm run burrow       # node burrow/generate.cjs
   npm run check:web
   npm test             # test/burrow.test.ts: generated/ matches the export, the art draws
   ```

   `generate.cjs` stops with an error if the export has changed shape in a way it doesn't
   handle, for example new themes, a bundle that is no longer one IIFE, or art that needs React.
   Fix the generator, never the export.
4. Commit `burrow/export/` and `src/burrow/generated/` together and push. Then bump Warren's pin
   in each app (`server/package.json` and `web/package.json`), rebuild, look at every screen
   in both apps, and release them.

If the export brings new art or component classes that an app wants as a Svelte component, add
the component in `src/burrow/` when it is app-neutral, or in the app when it isn't.
