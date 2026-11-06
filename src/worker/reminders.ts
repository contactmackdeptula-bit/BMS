// Daily reminder emails (SPEC.md §8, UI-HANDOFF §8).
//
// This runs as the system, not as a user, so it reads across buildings by
// design; it only ever emails a building's own reminder recipients about that
// building. One email per building per day, grouping every item due a reminder.
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { itemState, reminderDue, statusLabel, todayIn } from "../shared/compliance";
import {
  building,
  complianceItem,
  complianceOccurrence,
  membership,
  organisation,
  reminderLog,
  user,
} from "./db/schema";
import type { Env } from "./env";
import { sendEmail } from "./lib/email";
import { ulid } from "./lib/ids";

const RECIPIENT_ROLES = ["pcc_admin", "churchwarden", "treasurer", "member"] as const;
const SEND_HOUR = 7; // 07:00 local time

/** Called by the cron trigger; only acts in the 07:00 hour, Europe/London. */
export async function scheduledReminders(env: Env, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour !== SEND_HOUR) return { skipped: true, sent: 0 };
  return runReminders(env, now);
}

export async function runReminders(env: Env, now = new Date()) {
  const db = drizzle(env.DB);
  const buildings = await db
    .select({
      id: building.id,
      orgId: building.orgId,
      name: building.name,
      insuranceRenewsOn: building.insuranceRenewsOn,
      apcmDate: organisation.apcmDate,
      timezone: organisation.timezone,
    })
    .from(building)
    .innerJoin(organisation, eq(organisation.id, building.orgId))
    .all();

  let sent = 0;
  for (const b of buildings) {
    const today = todayIn(b.timezone, now);
    const items = await db
      .select()
      .from(complianceItem)
      .where(and(eq(complianceItem.buildingId, b.id), eq(complianceItem.active, true)))
      .all();
    if (items.length === 0) continue;
    const occs = await db
      .select()
      .from(complianceOccurrence)
      .where(inArray(complianceOccurrence.complianceItemId, items.map((i) => i.id)))
      .all();
    const anchors = { apcm: b.apcmDate, insuranceRenewal: b.insuranceRenewsOn };
    const due = items
      .map((i) => ({ item: i, state: itemState(i, occs.filter((o) => o.complianceItemId === i.id), anchors, today) }))
      .filter((x) => reminderDue(x.state))
      .sort((a, b) => (a.state.days ?? 0) - (b.state.days ?? 0));
    if (due.length === 0) continue;

    const recipients = (
      await db
        .select({ email: user.email })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(
          and(
            eq(membership.orgId, b.orgId),
            eq(membership.receivesReminders, true),
            inArray(membership.role, [...RECIPIENT_ROLES]),
          ),
        )
        .all()
    ).map((r) => r.email);
    const unique = [...new Set(recipients)];
    if (unique.length === 0) continue;

    // The unique (building, day) index makes this the once-a-day guard, even if the cron fires twice.
    const claimed = await db
      .insert(reminderLog)
      .values({ id: ulid(), buildingId: b.id, sentOn: today, recipients: unique, itemIds: due.map((d) => d.item.id) })
      .onConflictDoNothing()
      .returning({ id: reminderLog.id });
    if (claimed.length === 0) continue;

    const lines = due.map((d) => `- ${d.item.name}: ${statusLabel(d.state)}`);
    const subject =
      due.length === 1
        ? `${b.name}: ${due[0]!.item.name}, ${statusLabel(due[0]!.state).toLowerCase()}`
        : `${b.name}: ${due.length} checks need attention`;
    const text = [
      `These checks for ${b.name} need attention:`,
      "",
      ...lines,
      "",
      `Open the calendar to record them or book a contractor:`,
      `${env.APP_URL}/b/${b.id}/compliance`,
      "",
      `You get this because you're a reminder recipient for ${b.name} in ${env.PRODUCT_NAME}. A PCC admin can change that in Settings.`,
    ].join("\n");
    for (const to of unique) await sendEmail(env, { to, subject, text });
    sent++;
  }
  return { skipped: false, sent };
}
