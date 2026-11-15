/**
 * The web app's client for its own server. Every request carries `X-Warren`, which Warren requires
 * on writes (its CSRF check), and goes to the same origin with the session cookie.
 */

/** A failed request. `errors` holds per-field messages when the server refused a form. */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public errors: Record<string, string> = {}
	) {
		super(message);
	}
}

let onUnauthorized: (() => void | Promise<void>) | null = null;

/**
 * What to do when the server says nobody is signed in (401), usually going to the sign-in page:
 * `configureApi({ onUnauthorized: () => goto('/login') })` once, in the root layout.
 */
export function configureApi(options: { onUnauthorized?: () => void | Promise<void> }): void {
	if (options.onUnauthorized) onUnauthorized = options.onUnauthorized;
}

async function failure(res: Response): Promise<ApiError> {
	try {
		const body = await res.json();
		if (body?.errors && typeof body.errors === 'object') {
			const errors = body.errors as Record<string, string>;
			return new ApiError(res.status, Object.values(errors).join(' '), errors);
		}
		if (typeof body?.detail === 'string') return new ApiError(res.status, body.detail);
		if (Array.isArray(body?.detail)) return new ApiError(res.status, body.detail.map((d: { msg: string }) => d.msg).join('; '));
	} catch {
		/* not JSON */
	}
	return new ApiError(res.status, `${res.status} ${res.statusText}`);
}

/** The response itself, for bodies that aren't JSON. Throws `ApiError` unless it is 2xx. */
export async function raw(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('X-Warren', '1');
	const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
	if (res.status === 401 && onUnauthorized && !location.pathname.startsWith('/login')) {
		await onUnauthorized();
		throw new ApiError(401, 'Not signed in');
	}
	if (!res.ok) throw await failure(res);
	return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	return (await (await raw(path, init)).json()) as T;
}

function withBody(method: string, body: unknown): RequestInit {
	return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) };
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, withBody('POST', body));
export const put = <T>(path: string, body: unknown) => api<T>(path, withBody('PUT', body));
export const patch = <T>(path: string, body: unknown) => api<T>(path, withBody('PATCH', body));
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** A query string (with its `?`) from the values that are set; empty when none are. */
export function query(params: Record<string, string | number | boolean | null | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== null && value !== undefined && value !== '' && value !== false) search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : '';
}
