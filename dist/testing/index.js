// Test helpers for code outside this package. Needs `vitest`, an optional peer
// dependency. Nothing else in src/ imports from here.
export { INITIAL, storeContract } from './store-contract.js';
export { fakeSink, SAMPLE_NOTE, SAMPLE_SENDER, sinkContract } from './sink-contract.js';
