/**
 * Screens change like a native app's: a screen opened from another slides in over it from the
 * side, going back slides it away again, and switching between the nav's top-level screens
 * cross-fades. It runs on the View Transitions API; motion.css holds the animations, keyed on
 * `html[data-nav]`. Browsers without the API, and reduced motion, change screens at once.
 *
 *   onNavigate((navigation) => pageTransition(navigation, { tabs: ['/', '/history', '/settings'] }));
 */

/** The parts of SvelteKit's `Navigation` this needs. */
export interface NavigationLike {
	type: string;
	delta?: number;
	willUnload?: boolean;
	from: { url: URL; route: { id: string | null } } | null;
	to: { url: URL; route: { id: string | null } } | null;
	complete: Promise<void>;
}

export type Direction = 'forward' | 'back' | 'tab';

const depth = (path: string) => path.split('/').filter(Boolean).length;

/**
 * Which way a navigation goes. `tabs` are the nav's top-level screens (`'/'` matches only itself;
 * any other entry matches itself and nothing deeper). Between two of them it is `tab` whichever way
 * history went; otherwise the browser's back and forward buttons decide, and for a link, a deeper
 * address is `forward` and a shallower one `back`. Null means no transition: the same screen with
 * other data (another month, a filter), or nowhere to go.
 */
export function direction(navigation: NavigationLike, tabs: readonly string[] = []): Direction | null {
	const { from, to } = navigation;
	if (!from || !to || navigation.willUnload) return null;
	if (from.route.id === to.route.id && from.url.pathname === to.url.pathname) return null;
	const isTab = (path: string) => tabs.includes(path.replace(/\/+$/, '') || '/');
	if (isTab(from.url.pathname) && isTab(to.url.pathname)) return 'tab';
	if (navigation.type === 'popstate') return (navigation.delta ?? -1) < 0 ? 'back' : 'forward';
	const a = depth(from.url.pathname);
	const b = depth(to.url.pathname);
	if (b > a) return 'forward';
	if (b < a) return 'back';
	return from.route.id === to.route.id ? null : 'tab';
}

let skipNext = false;

/** The next navigation changes screens without a transition (a gesture already moved the screen). */
export function skipNextTransition(): void {
	skipNext = true;
}

/**
 * Run a navigation inside a view transition; return this from SvelteKit's `onNavigate`. Options:
 * `tabs` (see `direction`), and `same: true` to cross-fade the same screen with other data too.
 */
export function pageTransition(navigation: NavigationLike, options: { tabs?: readonly string[]; same?: boolean } = {}): Promise<void> | void {
	if (skipNext) {
		skipNext = false;
		return;
	}
	if (typeof document === 'undefined' || !document.startViewTransition) return;
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const dir = direction(navigation, options.tabs) ?? (options.same && navigation.to && !navigation.willUnload ? 'tab' : null);
	if (!dir) return;

	const root = document.documentElement;
	root.dataset.nav = dir;
	return new Promise((resolve) => {
		const transition = document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
		transition.finished.finally(() => {
			if (root.dataset.nav === dir) delete root.dataset.nav;
		});
	});
}
