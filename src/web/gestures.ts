/**
 * Touch gestures a phone app has: pulling a sheet down to close it, and swiping in from the left
 * edge to go back. Both follow the finger and spring back when let go too early.
 */
import { prefersReducedMotion } from 'svelte/motion';
import { skipNextTransition } from './navigation.ts';

const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';

/**
 * An attachment for a sheet's panel: dragging it down from a handle (elements matching `handle`,
 * default `[data-drag-handle]`; give them `touch-action: none`) moves it with the finger, and
 * letting go far or fast enough calls `onDismiss`. The panel's `translate` follows the finger, so it
 * adds to whatever transform its own transitions use; on dismiss it stays where the finger left it,
 * and the sheet's leaving transition carries on from there. While dragging, the panel's parent gets
 * `--wn-drag` from 0 to 1 (how far towards closed), for fading a scrim.
 */
export function dragToDismiss(options: { onDismiss: () => void; handle?: string }) {
	return (panel: HTMLElement) => {
		const handle = options.handle ?? '[data-drag-handle]';
		let start: { y: number; t: number; id: number } | null = null;
		let last = { y: 0, t: 0 };
		let prev = { y: 0, t: 0 };

		const set = (dy: number) => {
			panel.style.translate = dy ? `0 ${dy}px` : '';
			panel.parentElement?.style.setProperty('--wn-drag', String(Math.min(1, dy / Math.max(1, panel.offsetHeight))));
		};

		const down = (e: PointerEvent) => {
			if (e.button !== 0 || !(e.target as Element).closest(handle)) return;
			start = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
			last = prev = { y: e.clientY, t: e.timeStamp };
			panel.setPointerCapture(e.pointerId);
			panel.style.transition = 'none';
		};
		const move = (e: PointerEvent) => {
			if (!start || e.pointerId !== start.id) return;
			const dy = e.clientY - start.y;
			// upwards it resists, as a sheet that is already fully open does
			set(dy > 0 ? dy : -Math.sqrt(-dy) * 2);
			prev = last;
			last = { y: e.clientY, t: e.timeStamp };
		};
		const up = (e: PointerEvent) => {
			if (!start || e.pointerId !== start.id) return;
			const dy = e.clientY - start.y;
			// the up event lands where the last move was, so the speed comes from the last two moves
			const speed = (last.y - prev.y) / Math.max(1, last.t - prev.t);
			start = null;
			if (dy > Math.min(140, panel.offsetHeight * 0.3) || (dy > 24 && speed > 0.5)) {
				panel.style.transition = '';
				options.onDismiss();
				return;
			}
			panel.style.transition = prefersReducedMotion.current ? 'none' : `translate .35s ${SPRING}`;
			set(0);
		};

		panel.addEventListener('pointerdown', down);
		panel.addEventListener('pointermove', move);
		panel.addEventListener('pointerup', up);
		panel.addEventListener('pointercancel', up);
		return () => {
			panel.removeEventListener('pointerdown', down);
			panel.removeEventListener('pointermove', move);
			panel.removeEventListener('pointerup', up);
			panel.removeEventListener('pointercancel', up);
		};
	};
}

/**
 * Swipe in from the left edge to go back, for phones without a system back gesture (an app added to
 * an iPhone's home screen has none). An attachment for the element that holds the screen (`main`):
 * it follows the finger, and once let go far or fast enough it slides off and the previous screen
 * takes its place. `canGoBack` says whether there is anywhere to go (not on a top-level screen, say);
 * `back` goes there (default `history.back()`). Touch events rather than pointer events, because
 * Safari cancels pointer events as soon as it thinks the page might scroll.
 */
export function swipeBack(options: { canGoBack: () => boolean; back?: () => void; edge?: number }) {
	return (screen: HTMLElement) => {
		const edge = options.edge ?? 24;
		let start: { x: number; y: number } | null = null;
		let tracking = false;
		let last = { x: 0, t: 0 };
		let prev = { x: 0, t: 0 };

		const reset = (animate: boolean) => {
			screen.style.transition = animate && !prefersReducedMotion.current ? `translate .3s ${SPRING}` : 'none';
			screen.style.translate = '';
			screen.classList.remove('wn-swiping');
			document.documentElement.style.removeProperty('--wn-swipe');
		};

		const begin = (e: TouchEvent) => {
			const touch = e.touches[0];
			if (e.touches.length !== 1 || !touch || touch.clientX > edge || !options.canGoBack()) return;
			if (document.querySelector('[aria-modal="true"]')) return;
			start = { x: touch.clientX, y: touch.clientY };
			tracking = false;
			last = prev = { x: touch.clientX, t: e.timeStamp };
		};
		const move = (e: TouchEvent) => {
			const touch = e.touches[0];
			if (!start || !touch) return;
			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			if (!tracking) {
				if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null);
				if (dx < 10) return;
				tracking = true;
				screen.style.transition = 'none';
				screen.classList.add('wn-swiping');
			}
			e.preventDefault();
			screen.style.translate = `${Math.max(0, dx)}px 0`;
			document.documentElement.style.setProperty('--wn-swipe', String(Math.min(1, dx / innerWidth)));
			prev = last;
			last = { x: touch.clientX, t: e.timeStamp };
		};
		const end = () => {
			if (!start) return;
			const was = tracking;
			const dx = last.x - start.x;
			const speed = (last.x - prev.x) / Math.max(1, last.t - prev.t);
			start = null;
			tracking = false;
			if (!was) return;
			if (dx > innerWidth * 0.35 || (dx > 40 && speed > 0.35)) {
				screen.style.transition = prefersReducedMotion.current ? 'none' : 'translate .18s ease-out';
				screen.style.translate = `${innerWidth}px 0`;
				setTimeout(() => {
					skipNextTransition();
					(options.back ?? (() => history.back()))();
					// the previous screen is drawn in place, then the element comes back to the middle
					setTimeout(() => reset(false), 60);
				}, prefersReducedMotion.current ? 0 : 170);
			} else {
				reset(true);
			}
		};

		addEventListener('touchstart', begin, { passive: true });
		addEventListener('touchmove', move, { passive: false });
		addEventListener('touchend', end);
		addEventListener('touchcancel', end);
		return () => {
			removeEventListener('touchstart', begin);
			removeEventListener('touchmove', move);
			removeEventListener('touchend', end);
			removeEventListener('touchcancel', end);
		};
	};
}
