<script lang="ts">
	import { traceSVG, type TraceName } from './generated/art.js';

	/* Burrow's Trace: one of the natural things an animal leaves behind. Decorative. */
	let {
		name,
		size = 32,
		class: cls = '',
		style = ''
	}: { name: TraceName; size?: number; class?: string; style?: string } = $props();
</script>

<span class="bh-trace {cls}" style="width: {size}px; height: {size}px; {style}" aria-hidden="true">{@html traceSVG(name, size)}</span>
