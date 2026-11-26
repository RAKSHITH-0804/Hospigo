import { AsyncLocalStorage } from 'node:async_hooks';
import { setTermsReader, type Terms } from '@/lib/terminology/terms-core';

/** Server only: the words of the hospital of the request being rendered (never shared between requests). */
const store = new AsyncLocalStorage<Terms>();
setTermsReader(() => store.getStore());

/** Called by the app layout once the hospital's words are known; they then apply to the rest of this request. */
export const enterTerms = (terms: Terms): void => store.enterWith(terms);

/** For tests of the server side: run something as if for one hospital. */
export const runWithTerms = <T>(terms: Terms, fn: () => T): T => store.run(terms, fn);
