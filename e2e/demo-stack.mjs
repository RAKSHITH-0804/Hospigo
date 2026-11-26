/** Starts the isolated stack (API 3100, web 3101) on the showcase database hospigo_demo. */
process.env.STACK_DB = 'hospigo_demo';
await import('./test-stack.mjs');
