import { defineConfig } from "drizzle-kit";

// Warren's own tables only. Each app has its own config for its tables and filters these out.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/schema.ts",
  out: "./migrations",
});
