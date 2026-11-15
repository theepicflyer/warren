/** What every app's web client keeps: who is signed in, toasts, and "the data changed". */
import { ApiError, get } from './api.ts';

/** Who is signed in (`/api/me`), loaded once and shared; `load(true)` asks again. */
export class Session<Me> {
	me = $state<Me | null>(null);
	#loading: Promise<Me | null> | null = null;

	constructor(private path = '/api/me') {}

	load(force = false): Promise<Me | null> {
		if (force || !this.#loading) {
			this.#loading = get<Me>(this.path)
				.then((me) => (this.me = me))
				.catch(() => (this.me = null));
		}
		return this.#loading;
	}
}

export interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

export type Toast<Extra> = { id: number; message: string; action: ToastAction | null } & Extra;

/**
 * Toasts. `Extra` is what the app's toast shows besides the message (Burrow's animal and mood, say);
 * `onError` is the extra for errors. A toast with an action stays longer. `items` is every toast on
 * screen, oldest first; `current` the newest, for apps that show one at a time.
 */
export class Toasts<Extra extends object = object> {
	items = $state<Toast<Extra>[]>([]);
	#id = 0;

	constructor(private options: { defaults: Extra; onError: Partial<Extra>; max?: number }) {}

	get current(): Toast<Extra> | null {
		return this.items.at(-1) ?? null;
	}

	show(message: string, options: Partial<Extra> & { action?: ToastAction | null; ms?: number } = {}): number {
		const { action = null, ms, ...extra } = options;
		const id = ++this.#id;
		const toast = { ...this.options.defaults, ...(extra as Partial<Extra>), id, message, action } as Toast<Extra>;
		this.items = [...this.items, toast].slice(-(this.options.max ?? 3));
		setTimeout(() => this.dismiss(id), ms ?? (action ? 7000 : 4000));
		return id;
	}

	/** Something went wrong: the message of an `ApiError` or `Error`, with the error extra. */
	error(err: unknown, ms = 6000): number {
		const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		return this.show(message, { ...this.options.onError, ms });
	}

	/** Without an id, every toast. */
	dismiss(id?: number): void {
		this.items = id === undefined ? [] : this.items.filter((t) => t.id !== id);
	}
}

/**
 * "The data changed": bumped after every write, so whatever is loaded on screen loads again.
 * `loaded()` reads it; anything else can read `changes.version` inside an effect.
 */
class Changes {
	version = $state(0);
	changed(): void {
		this.version++;
	}
}
export const changes = new Changes();
