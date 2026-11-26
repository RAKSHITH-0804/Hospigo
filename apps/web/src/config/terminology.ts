/** Step 2.1f: how the hospital's own words (terminology overrides) are looked up in the web app. */
export const terminologyConfig = {
  /** How long a hospital's words are kept in the web server before the API is asked again. */
  cacheSeconds: 60,
  /** The most hospitals kept in that memory at once. */
  cacheMaxEntries: 200,
} as const;
