<script lang="ts">
	import { worldSVG } from './generated/art.js';

	/* Burrow's World: all four habitats in one landscape (sign-in, About). */
	const svg = worldSVG();
</script>

<div class="bh-world-wrap">{@html svg}</div>
