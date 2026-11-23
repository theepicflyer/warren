/**
 * warren/burrow: Burrow, the household's design system, for the apps' SvelteKit clients. Its art as
 * SVG strings (generated/art.js), the drawings that change with a count (generated/scenes.ts), and
 * Svelte components for the app-neutral parts of Burrow, drawn with Burrow's own bh-* classes.
 * Import the styles as well: `warren/burrow/tokens.css` and `warren/burrow/burrow.css` (and
 * `warren/burrow/type.css` for the text-style classes). Everything under generated/ comes from
 * burrow/generate.cjs; re-sync from the artifact rather than editing it (burrow/README.md).
 */
export * from './generated/art.js';
export { stashArt, wreathArt } from './generated/scenes.ts';
export { default as Mascot } from './Mascot.svelte';
export { default as Trace } from './Trace.svelte';
export { default as Habitat } from './Habitat.svelte';
export { default as Peek } from './Peek.svelte';
export { default as World } from './World.svelte';
export { default as Breadcrumbs } from './Breadcrumbs.svelte';
export { default as TunnelRow } from './TunnelRow.svelte';
export { default as Loader } from './Loader.svelte';
export { default as Toast } from './Toast.svelte';
