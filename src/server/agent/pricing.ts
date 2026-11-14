/** Per-model token prices in USD per million tokens, used to report what each turn cost. */

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

export const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  calls: number;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, calls: 0 };
}

/** The `usage` object of a Messages API response. */
export interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export function addUsage(total: Usage, usage: ApiUsage): void {
  total.calls += 1;
  total.input += usage.input_tokens ?? 0;
  total.output += usage.output_tokens ?? 0;
  total.cache_read += usage.cache_read_input_tokens ?? 0;
  if (usage.cache_creation) {
    total.cache_write_5m += usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
    total.cache_write_1h += usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
  } else {
    total.cache_write_5m += usage.cache_creation_input_tokens ?? 0;
  }
}

export function cost(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cache_read * price.cacheRead +
      usage.cache_write_5m * price.input * 1.25 +
      usage.cache_write_1h * price.input * 2) /
    1_000_000
  );
}
