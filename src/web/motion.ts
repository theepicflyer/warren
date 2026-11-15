/**
 * Motion for the apps' web clients. Svelte's own transitions ignore the device's reduced-motion
 * setting; these stand still under it. Use them for things added, removed or swapped after a screen
 * opens; screens themselves change with `pageTransition` (navigation.ts) and motion.css.
 */
import { flip as baseFlip, type AnimationConfig, type FlipParams } from 'svelte/animate';
import { backOut, cubicOut, quintOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import * as t from 'svelte/transition';

const still = { duration: 0 };

/** A springy curve, cubic-bezier(.34, 1.56, .64, 1): a little past the mark and back. */
export const spring = backOut;

export const fade: typeof t.fade = (node, params) => (prefersReducedMotion.current ? still : t.fade(node, params));

export const fly: typeof t.fly = (node, params) => (prefersReducedMotion.current ? still : t.fly(node, { easing: cubicOut, ...params }));

export const scale: typeof t.scale = (node, params) => (prefersReducedMotion.current ? still : t.scale(node, { easing: cubicOut, ...params }));

export const slide: typeof t.slide = (node, params) => (prefersReducedMotion.current ? still : t.slide(node, { easing: cubicOut, ...params }));

/** Something appearing in place: up a few pixels and in. */
export const rise: typeof t.fly = (node, params) => fly(node, { y: 8, duration: 260, ...params });

/** A list row arriving or leaving: it opens or closes its space and fades, so the rows around it move rather than jump. */
export function row(node: Element, params: { duration?: number } = {}): t.TransitionConfig {
	if (prefersReducedMotion.current) return still;
	const opened = t.slide(node, { duration: params.duration ?? 240, easing: cubicOut });
	return {
		...opened,
		css: (u, v) => `${opened.css?.(u, v) ?? ''};opacity:${u}`
	};
}

/**
 * A sheet sliding up from the bottom edge, its whole height, and back down again as a phone's
 * sheets do. It slides rather than fades, so a sheet pulled partway down (`dragToDismiss`) carries
 * on down from where the finger left it. Use it as `in:sheet out:sheet`: with `transition:sheet`
 * Svelte plays the entrance backwards to close it.
 */
export function sheet(node: Element, _params: unknown, { direction }: { direction: 'in' | 'out' | 'both' }): t.TransitionConfig {
	if (prefersReducedMotion.current) return still;
	// the last stretch fades too, for a sheet centred as a dialog on a wide screen that never leaves it
	const css = (u: number) => `transform: translateY(${(1 - u) * 100}%); opacity: ${Math.min(1, u * 3)}`;
	return direction === 'out' ? { duration: 300, easing: cubicOut, css } : { duration: 440, easing: quintOut, css };
}

/** Rows that move when the list changes order or gains and loses rows (`animate:flip`). */
export function flip(node: Element, fromTo: { from: DOMRect; to: DOMRect }, params?: FlipParams): AnimationConfig {
	return prefersReducedMotion.current ? still : baseFlip(node, fromTo, { duration: 260, easing: cubicOut, ...params });
}

/**
 * An attachment for a nav (`{@attach slidingPill}`): the current item's highlight becomes one blob
 * that slides from item to item. The nav marks its current item with `aria-current="page"`, and each
 * item holds an element matching `pill` (default `.bh-nav__pill`). The blob is a `span.wn-pill-blob`
 * the app styles; the nav gets `has-blob` so it can hide the item's own highlight.
 */
export function slidingPill(pill = '.bh-nav__pill') {
	return (nav: HTMLElement) => {
		const blob = document.createElement('span');
		blob.className = 'wn-pill-blob';
		blob.setAttribute('aria-hidden', 'true');
		nav.prepend(blob);
		nav.classList.add('has-blob');

		const place = () => {
			const target = nav.querySelector<HTMLElement>(`[aria-current="page"] ${pill}`);
			const item = target?.closest<HTMLElement>('[aria-current="page"]');
			blob.hidden = !target || !item;
			if (!target || !item) return;
			// offsets rather than client rects, so a transform on the way in doesn't throw it off
			blob.style.translate = `${item.offsetLeft + target.offsetLeft}px ${item.offsetTop + target.offsetTop}px`;
			blob.style.width = `${target.offsetWidth}px`;
			blob.style.height = `${target.offsetHeight}px`;
		};
		place();
		// the first placement doesn't slide in from the corner
		requestAnimationFrame(() => blob.classList.add('is-placed'));
		const moved = new MutationObserver(place);
		moved.observe(nav, { subtree: true, attributeFilter: ['aria-current'] });
		const resized = new ResizeObserver(place);
		resized.observe(nav);

		return () => {
			moved.disconnect();
			resized.disconnect();
			blob.remove();
			nav.classList.remove('has-blob');
		};
	};
}

const PATTERNS = { tap: [6], select: [10], success: [12, 60, 12], warning: [30, 50, 30] } as const;

/**
 * A short buzz, where the device has one (Android; iPhones ignore it): `tap` for a key, `select`
 * for a choice, `success` when something saved, `warning` when something was refused or deleted.
 */
export function haptic(kind: keyof typeof PATTERNS = 'tap'): void {
	try {
		navigator.vibrate?.([...PATTERNS[kind]]);
	} catch {
		/* not allowed here */
	}
}
