<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { untrack } from 'svelte';
	import { arrivedBy } from './navigation.ts';

	/**
	 * A number that counts to its value: up from zero the first time it shows, then from the old
	 * value to each new one. On a screen reached by going back it starts at its value, as the screen
	 * was left. `format` turns the in-between number into text; null shows `empty`.
	 */
	let {
		value,
		format = (n: number) => `${Math.round(n)}`,
		empty = '–',
		duration = 700
	}: { value: number | null | undefined; format?: (n: number) => string; empty?: string; duration?: number } = $props();

	// the starting point only, on purpose: later values count from wherever it is
	const start = untrack(() => (arrivedBy() === 'back' ? (value ?? 0) : 0));
	const shown = new Tween(start, { easing: cubicOut });

	$effect(() => {
		if (value != null) shown.set(value, { duration: prefersReducedMotion.current ? 0 : duration });
	});
</script>

{value == null ? empty : format(shown.current)}
