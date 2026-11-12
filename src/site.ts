// A site's code lives in src/site/ (index.ts says what is where). This file keeps the old import path,
// src/site.js, working for one release: code outside the repository (the building-on-tykerf examples) uses it.
export * from './site/index.js';
