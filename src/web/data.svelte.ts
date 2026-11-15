/**
 * Data for screens, kept like a native app keeps it: a screen opened before shows what it showed
 * last time at once (so going back is instant and the scroll position lands on real content), then
 * refreshes underneath. Responses are cached by address, in memory, for this tab only.
 */
import { get } from './api.ts';
import { changes } from './state.svelte.ts';

const LIMIT = 50;
const cache = new Map<string, unknown>();
let onError: ((err: unknown) => void) | null = null;

/** What to do when a load fails (not a 401): usually `(err) => toasts.error(err)`. */
export function configureData(options: { onError?: (err: unknown) => void }): void {
	if (options.onError) onError = options.onError;
}

function remember(url: string, data: unknown): void {
	cache.delete(url);
	cache.set(url, data);
	if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
}

/** Forget everything loaded, e.g. on sign-out, so the next person never sees it. */
export function forgetData(): void {
	cache.clear();
}

/** Load an address into the cache ahead of time, e.g. when a finger lands on a link. */
export function preload(url: string): void {
	if (!cache.has(url)) get(url).then((data) => remember(url, data), () => {});
}

export interface Loaded<T> {
	/** The data, or null before the first answer. While a new address loads, the last data stays. */
	readonly data: T | null;
	/** A load is under way (the first, or a refresh). */
	readonly loading: boolean;
	/** The last load failed. */
	readonly failed: boolean;
	reload(): void;
}

/**
 * A screen's data from `path`, which is read reactively: the data loads again when the address
 * changes, when anything calls `changes.changed()`, and on `reload()`. A null address loads nothing.
 * Call it while the component is set up.
 *
 *   const home = loaded<Home>(() => `/api/home${query({ month })}`);
 */
export function loaded<T>(path: () => string | null): Loaded<T> {
	const first = path();
	let data = $state<T | null>(first && cache.has(first) ? (cache.get(first) as T) : null);
	let loading = $state(false);
	let failed = $state(false);
	let again = $state(0);

	$effect(() => {
		const url = path();
		void changes.version;
		void again;
		if (!url) return;
		if (cache.has(url)) data = cache.get(url) as T;
		let stale = false;
		loading = true;
		get<T>(url)
			.then((result) => {
				remember(url, result);
				if (stale) return;
				data = result;
				failed = false;
			})
			.catch((err) => {
				if (stale || err?.status === 401) return;
				failed = true;
				onError?.(err);
			})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => {
			stale = true;
		};
	});

	return {
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		get failed() {
			return failed;
		},
		reload: () => void again++
	};
}
