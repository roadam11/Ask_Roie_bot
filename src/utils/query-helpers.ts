/**
 * Centralized SQL helpers for demo lead filtering.
 *
 * Demo leads (is_demo = true) must be excluded from all analytics/KPI queries
 * but remain visible in the leads list for badge display.
 */

/** SQL fragment to exclude demo leads. Append to WHERE clauses on `leads` aliased as `l`. */
export const EXCLUDE_DEMO = `AND (l.is_demo = false OR l.is_demo IS NULL)`;

/** Same for queries that alias leads without prefix (direct table reference). */
export const EXCLUDE_DEMO_BARE = `AND (is_demo = false OR is_demo IS NULL)`;
