/**
 * `now()` (in the jurisdiction's timezone) falls within a schedule row's [startTime, endTime]
 * window. `BETWEEN` alone requires start <= end, so an overnight shift (e.g. 22:00-06:00) would
 * never match anything; the OR branch covers the wraparound case where start > end. `alias` is
 * the schedule table's SQL alias in the surrounding query (e.g. "s"), which must also join a
 * `jurisdictions j` for the timezone.
 */
export function withinScheduleWindow(alias: string): string {
  return `(
    (${alias}."startTime" <= ${alias}."endTime"
      AND (now() AT TIME ZONE j.timezone)::time BETWEEN ${alias}."startTime" AND ${alias}."endTime")
    OR (${alias}."startTime" > ${alias}."endTime"
      AND ((now() AT TIME ZONE j.timezone)::time >= ${alias}."startTime"
        OR (now() AT TIME ZONE j.timezone)::time <= ${alias}."endTime"))
  )`;
}

/** Whether today (in the jurisdiction's timezone) matches a recurring `dayOfWeek` or a one-off `date`. */
export function onScheduledDay(alias: string): string {
  return `(
    ${alias}."dayOfWeek" = EXTRACT(DOW FROM (now() AT TIME ZONE j.timezone))
    OR ${alias}.date = (now() AT TIME ZONE j.timezone)::date
  )`;
}
