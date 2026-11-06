export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  PRODUCT_NAME: string;
  PRODUCT_TAGLINE: string;
  APP_URL: string;
  /** "log" prints emails (dev and tests); "brevo" sends through Brevo. */
  EMAIL_MODE: "log" | "brevo";
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
}
