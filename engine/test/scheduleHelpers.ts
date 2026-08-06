import type { AppDb } from "@voyager/shared";
import { makeSchedule } from "@voyager/shared/test";

/** Every dayOfWeek, all day — deterministically "on duty" regardless of when the test runs. */
export async function putOnDutyAllDay(db: AppDb, workerId: string): Promise<void> {
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    await db.models.Schedule.create(
      makeSchedule(workerId, { dayOfWeek, startTime: "00:00:00", endTime: "23:59:59", type: "shift" }),
    );
  }
}

/** Every dayOfWeek, all day — deterministically "on timeoff" regardless of when the test runs. */
export async function putOnTimeoffAllDay(db: AppDb, workerId: string): Promise<void> {
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    await db.models.Schedule.create(
      makeSchedule(workerId, { dayOfWeek, startTime: "00:00:00", endTime: "23:59:59", type: "timeoff" }),
    );
  }
}
