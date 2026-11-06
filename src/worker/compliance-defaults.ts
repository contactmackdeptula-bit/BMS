// The default checklist seeded on every new building (SPEC.md §6).
// Frequencies are starting guidance from insurers' and dioceses' advice; each
// church can change them per item.
import type { Anchor } from "../shared/compliance";

export type Template = {
  key: string;
  name: string;
  frequencyMonths: number;
  anchor: Anchor;
  doneBy: string;
  note: string;
  selfCheck?: boolean;
  fittingKind?: string;
  /** Only seeded when the building profile says so. */
  when?: "hasLift" | "hasWaterSystems";
};

export const DEFAULT_CHECKLIST: Template[] = [
  {
    key: "lightning_protection",
    name: "Lightning protection system test",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Specialist lightning protection contractor",
    note: "Insurers expect a test at least every four years; annual testing is recommended.",
  },
  {
    key: "asbestos_review",
    name: "Asbestos register review",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Churchwardens",
    note: "Walk round with the asbestos register, check nothing has changed or been disturbed, then sign and date it.",
  },
  {
    key: "fire_risk_review",
    name: "Fire risk assessment review",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Churchwardens, or a fire risk assessor",
    note: "Review the written assessment every year and after any change to the building or how it is used.",
  },
  {
    key: "fire_extinguishers",
    name: "Fire extinguisher service",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Fire protection contractor",
    note: "Annual service by a competent person; keep the service certificate.",
  },
  {
    key: "emergency_lighting_monthly",
    name: "Emergency lighting monthly flick test",
    frequencyMonths: 1,
    anchor: "none",
    doneBy: "Churchwarden or volunteer",
    note: "Press the test key on each emergency light and check it comes on. Takes about ten minutes.",
    selfCheck: true,
    fittingKind: "emergency_light",
  },
  {
    key: "emergency_lighting_annual",
    name: "Emergency lighting annual duration test",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Electrician",
    note: "Full-duration discharge test of every emergency light, with a test certificate.",
  },
  {
    key: "gutters",
    name: "Gutters and rainwater goods clearance",
    frequencyMonths: 6,
    anchor: "none",
    doneBy: "Contractor or volunteers with safe access",
    note: "Clear gutters, hoppers, downpipes and gullies in spring and autumn. Blocked rainwater goods are the commonest cause of damage.",
  },
  {
    key: "gas_boiler",
    name: "Gas boiler service and safety check",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Gas Safe registered engineer",
    note: "Annual service with a gas safety record.",
  },
  {
    key: "pat",
    name: "Portable appliance testing",
    frequencyMonths: 12,
    anchor: "none",
    doneBy: "Competent person or electrician",
    note: "Test portable electrical equipment and keep the register.",
  },
  {
    key: "eicr",
    name: "Electrical installation condition report",
    frequencyMonths: 60,
    anchor: "none",
    doneBy: "Registered electrician",
    note: "Fixed wiring inspection and report (EICR) at least every five years.",
  },
  {
    key: "insurance_renewal",
    name: "Insurance renewal",
    frequencyMonths: 12,
    anchor: "insurance_renewal",
    doneBy: "Treasurer",
    note: "Check the sums insured and the schedule before renewal. Set the renewal date on the Building page.",
  },
  {
    key: "churchwardens_inspection",
    name: "Churchwardens' annual fabric inspection",
    frequencyMonths: 12,
    anchor: "apcm",
    doneBy: "Churchwardens",
    note: "Inspect the fabric, goods and ornaments before the APCM and report to it. Set the APCM date in Settings.",
  },
  {
    key: "tree_survey",
    name: "Tree survey, churchyard",
    frequencyMonths: 36,
    anchor: "none",
    doneBy: "Arboriculturist",
    note: "A survey of churchyard trees by a qualified arboriculturist.",
  },
  {
    key: "quinquennial",
    name: "Quinquennial inspection",
    frequencyMonths: 60,
    anchor: "none",
    doneBy: "Inspecting architect or surveyor",
    note: "The five-yearly inspection under the Care of Churches Measure. Its recommendations become tasks on the Quinquennial page.",
  },
  {
    key: "lift",
    name: "Lift inspection (LOLER)",
    frequencyMonths: 6,
    anchor: "none",
    doneBy: "Lift engineer or insurer's inspector",
    note: "Thorough examination of passenger lifts every six months.",
    when: "hasLift",
  },
  {
    key: "legionella",
    name: "Legionella risk assessment",
    frequencyMonths: 24,
    anchor: "none",
    doneBy: "Competent person",
    note: "Assess hot and cold water systems, especially in halls and kitchens that stand unused for long periods.",
    when: "hasWaterSystems",
  },
];
