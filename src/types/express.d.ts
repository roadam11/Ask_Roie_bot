import 'express';

declare module 'express' {
  interface Request {
    /** Raw request body buffer, captured during JSON parsing for webhook signature verification */
    rawBody?: Buffer;
  }
}
