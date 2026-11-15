<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	/**
	 * A number that counts to its value: up from zero the first time it shows, then from the old
	 * value to each new one. `format` turns the in-between number into text; null shows `empty`.
	 */
	let {
		value,
		format = (n: number) => `${Math.round(n)}`,
		empty = '–',
		duration = 700
	}: { value: number | null | undefined; format?: (n: number) => string; empty?: string; duration?: number } = $props();

	const shown = new Tween(0, { easing: cubicOut });

	$effect(() => {
		if (value != null) shown.set(value, { duration: prefersReducedMotion.current ? 0 : duration });
	});
</script>

{value == null ? empty : format(shown.current)}
