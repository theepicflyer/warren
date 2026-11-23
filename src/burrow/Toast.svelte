<script lang="ts" generics="Extra extends object">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import Mascot from './Mascot.svelte';
	import type { Character, Mood } from './generated/art.js';
	import { fly, haptic } from '../web/motion.ts';
	import type { Toast, Toasts } from '../web/state.svelte.ts';

	/**
	 * Burrow's Toast: it takes the bottom nav's place (same spot, width and height) for `ms`, then the nav comes back.
	 * Give it a `Toasts` made with `max: 1, timed: false`: one at a time, a new one replacing the one on show, and
	 * this times it. The app positions it with `style` (where its nav sits) and hides its nav while
	 * `toasts.current` is set. Swipe it left, right or down to dismiss: it follows the finger, and past 64px or on
	 * a flick it carries on off that way; otherwise it springs back. The clock stops while it's held, and a 3px
	 * line along the bottom shows the time left. Under reduced motion it comes and goes without sliding.
	 */
	let {
		toasts,
		look = (t) => t as { character?: Character; mood?: Mood },
		ms = 5000,
		class: cls = '',
		style = ''
	}: {
		toasts: Toasts<Extra>;
		/** The animal and mood for a toast; by default its own `character` and `mood`. */
		look?: (toast: Toast<Extra>) => { character?: Character; mood?: Mood };
		ms?: number;
		class?: string;
		/** Where it sits: `left`, `right` and `padding-bottom` matching the nav's, say. */
		style?: string;
	} = $props();

	const FAR = 64;
	const FLICK = 0.5; // px per ms

	const toast = $derived(toasts.current);
	let left = $state(1); // time left, 1 to 0
	let dx = $state(0);
	let dy = $state(0);
	let held = $state(false);
	let settling = $state(false);
	// which way the last one went, for its way out
	let away = { x: 0, y: 0 };

	// A fresh clock for each toast, counting only while nobody holds it.
	$effect(() => {
		const id = toast?.id;
		if (id == null) return;
		left = 1;
		dx = dy = 0;
		away = { x: 0, y: 0 };
		let last = performance.now();
		let frame = requestAnimationFrame(function step(now) {
			if (!held) left = Math.max(0, left - (now - last) / ms);
			last = now;
			if (left <= 0) toasts.dismiss(id);
			else frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	let start: { x: number; y: number; axis: 'x' | 'y' | null } | null = null;
	let lastMove = { x: 0, y: 0, t: 0 };

	function down(e: PointerEvent) {
		if ((e.target as Element).closest('button, a')) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		start = { x: e.clientX, y: e.clientY, axis: null };
		lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
		held = true;
		settling = false;
	}

	function move(e: PointerEvent) {
		if (!start) return;
		const mx = e.clientX - start.x;
		const my = e.clientY - start.y;
		if (!start.axis && Math.hypot(mx, my) > 6) start.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
		// sideways it moves freely; up it barely gives, down it follows
		dx = start.axis === 'x' ? mx : 0;
		dy = start.axis === 'y' ? (my > 0 ? my : my / 6) : 0;
		lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
	}

	function up(e: PointerEvent, id: number) {
		if (!start) return;
		const dt = Math.max(1, e.timeStamp - lastMove.t + 16);
		const vx = (e.clientX - lastMove.x) / dt;
		const vy = (e.clientY - lastMove.y) / dt;
		const axis = start.axis;
		start = null;
		held = false;
		if (axis === 'x' && (Math.abs(dx) > FAR || Math.abs(vx) > FLICK)) {
			dismiss(id, { x: Math.sign(dx || vx), y: 0 });
		} else if (axis === 'y' && (dy > FAR || vy > FLICK)) {
			dismiss(id, { x: 0, y: 1 });
		} else {
			settling = true;
			dx = dy = 0;
		}
	}

	function dismiss(id: number, way: { x: number; y: number }) {
		away = way;
		haptic('tap');
		toasts.dismiss(id);
	}

	// Its way out: off the way it was swiped, from where the finger left it; otherwise it drops back behind the nav.
	function leave(node: HTMLElement) {
		if (prefersReducedMotion.current) return { duration: 0 };
		const from = { x: dx, y: dy };
		const swiped = away.x !== 0 || away.y !== 0;
		const to = away.x ? { x: away.x * (node.offsetWidth + 32), y: 0 } : { x: 0, y: away.y ? node.offsetHeight + 40 : 24 };
		return {
			duration: swiped ? 220 : 200,
			easing: cubicOut,
			css: (t: number, u: number) =>
				`--toast-dx: ${from.x + (to.x - from.x) * u}px; --toast-dy: ${from.y + (to.y - from.y) * u}px; opacity: ${swiped ? 1 : t}`
		};
	}
</script>

<div class="wn-toasts {cls}" {style} aria-live="polite">
	<div class="wn-toasts__spot">
		{#each toasts.items as t (t.id)}
			{@const who = look(t)}
			<div
				class="bh-toast wn-toast {settling ? 'is-settling' : ''}"
				role="status"
				style="--toast-dx: {dx}px; --toast-dy: {dy}px"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={(e) => up(e, t.id)}
				onpointercancel={(e) => up(e, t.id)}
				ontransitionend={() => (settling = false)}
				in:fly={{ y: 40, duration: 320, opacity: 0 }}
				out:leave
			>
				<Mascot character={who.character ?? 'bao'} mood={who.mood ?? (t.action ? 'happy' : 'joy')} size={40} class="bh-toast__who" />
				<span class="bh-toast__text">{t.message}</span>
				{#if t.action}
					{@const action = t.action}
					<button
						type="button"
						class="bh-btn wn-press"
						onclick={async () => {
							away = { x: 0, y: 0 };
							toasts.dismiss(t.id);
							haptic('select');
							await action.run();
						}}>{action.label}</button
					>
				{/if}
				<span class="bh-toast__time" style="width: {left * 100}%" aria-hidden="true"></span>
			</div>
		{/each}
	</div>
</div>

<style>
	.wn-toasts {
		position: fixed;
		bottom: 0;
		z-index: 40;
		pointer-events: none;
	}

	/* the nav's width; a new toast and the one it replaces share the spot while one goes and the other comes */
	.wn-toasts__spot {
		display: grid;
		max-width: var(--toast-w, 32rem);
		margin: 0 auto;
	}

	.wn-toast {
		grid-area: 1 / 1;
		pointer-events: auto;
		animation: none; /* the transitions above, not Burrow's pop */
	}

	/* let go short of the mark: it springs back */
	.is-settling {
		transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.is-settling {
			transition: none;
		}
	}
</style>
