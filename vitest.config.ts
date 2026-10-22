import { defineConfig } from 'vitest/config';

export default defineConfig({
  // editors started by the tests ignore the developer's own .env (its AI settings would change what they check)
  test: { env: { TYKERF_DOTENV: 'off' } },
});
