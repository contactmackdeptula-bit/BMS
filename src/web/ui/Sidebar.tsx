import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Building2,
  CalendarCheck,
  ClipboardList,
  FileText,
  FolderOpen,
  HardHat,
  LayoutDashboard,
  Layers,
  Menu,
  PoundSterling,
  Settings,
  Users,
  Wrench,
  X,
  BarChart3,
  Church,
  type LucideIcon,
} from "lucide-react";
import { formatDate, ROLE_LABELS } from "../format";

export type ChurchSection =
  | "dashboard"
  | "building"
  | "compliance"
  | "quinquennial"
  | "jobs"
  | "documents"
  | "contractors"
  | "reports"
  | "settings";

export type EstatesSection =
  | "overview"
  | "buildings"
  | "surveys"
  | "backlog"
  | "programmes"
  | "spend"
  | "contractors"
  | "reports"
  | "users";

type NavItem = { key: string; label: string; path: string; icon: LucideIcon };

export const CHURCH_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", path: "", icon: LayoutDashboard },
  { key: "building", label: "Building", path: "/building", icon: Church },
  { key: "compliance", label: "Compliance", path: "/compliance", icon: CalendarCheck },
  { key: "quinquennial", label: "Quinquennial", path: "/quinquennial", icon: ClipboardList },
  { key: "jobs", label: "Jobs and spend", path: "/jobs", icon: Wrench },
  { key: "documents", label: "Documents", path: "/documents", icon: FolderOpen },
  { key: "contractors", label: "Contractors", path: "/contractors", icon: HardHat },
  { key: "reports", label: "Reports", path: "/reports", icon: FileText },
  { key: "settings", label: "Settings", path: "/settings", icon: Settings },
];

export const ESTATES_NAV: NavItem[] = [
  { key: "overview", label: "Estate overview", path: "", icon: LayoutDashboard },
  { key: "buildings", label: "Buildings", path: "/buildings", icon: Building2 },
  { key: "surveys", label: "Survey cycle", path: "/surveys", icon: CalendarCheck },
  { key: "backlog", label: "Backlog", path: "/backlog", icon: ClipboardList },
  { key: "programmes", label: "Programmes", path: "/programmes", icon: Layers },
  { key: "spend", label: "Spend", path: "/spend", icon: PoundSterling },
  { key: "contractors", label: "Contractors", path: "/contractors", icon: HardHat },
  { key: "reports", label: "Reports", path: "/reports", icon: BarChart3 },
  { key: "users", label: "Users", path: "/users", icon: Users },
];

type Common = {
  productName: string;
  tagline: string;
  user: { name: string; role: string };
  onSignOut: () => void;
};

type ChurchProps = Common & {
  shell: "church";
  buildings: { id: string; name: string }[];
  activeBuildingId: string;
  activeSection: ChurchSection;
  apcmDate?: string | null;
  backToEstates?: string;
};

type EstatesProps = Common & {
  shell: "estates";
  org: { id: string; name: string; buildingCount: number; areaCount?: number };
  activeSection: EstatesSection;
  team?: string;
};

export function Sidebar(props: ChurchProps | EstatesProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const isChurch = props.shell === "church";
  const base = isChurch ? `/b/${props.activeBuildingId}` : `/org/${props.org.id}`;
  const items = isChurch ? CHURCH_NAV : ESTATES_NAV;
  const activeName = isChurch
    ? props.buildings.find((b) => b.id === props.activeBuildingId)?.name ?? ""
    : props.org.name;
  const roleLabel = ROLE_LABELS[props.user.role] ?? props.user.role;

  const switchBuilding = (id: string) => {
    if (!isChurch) return;
    const section = CHURCH_NAV.find((n) => n.key === props.activeSection)?.path ?? "";
    navigate(`/b/${id}${section}`);
  };

  // Phone: four tabs plus More, from UI-HANDOFF §5.
  const tabs = isChurch
    ? [CHURCH_NAV[0]!, CHURCH_NAV[2]!, CHURCH_NAV[4]!, CHURCH_NAV[5]!]
    : [ESTATES_NAV[0]!, ESTATES_NAV[1]!, ESTATES_NAV[3]!, ESTATES_NAV[4]!];
  const tabLabel: Record<string, string> = { dashboard: "Home", compliance: "Calendar", jobs: "Log", overview: "Home" };

  return (
    <>
      <div className="topbar">
        <div className="topbar-text">
          <span>{props.productName}</span>
          <strong>{activeName}</strong>
        </div>
        <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      <nav aria-label="Main" className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand">
          <div className="wordmark">{props.productName}</div>
          <div className="tagline">{props.tagline}</div>
        </div>

        {isChurch ? (
          props.buildings.length > 1 ? (
            <label className="sidebar-switcher">
              Church
              <select value={props.activeBuildingId} onChange={(e) => switchBuilding(e.target.value)}>
                {props.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="sidebar-org">
              <strong>{activeName}</strong>
            </div>
          )
        ) : (
          <div className="sidebar-org">
            <strong>{props.org.name}</strong>
            <span>
              {props.org.buildingCount} {props.org.buildingCount === 1 ? "building" : "buildings"}
              {props.org.areaCount != null && <> · {props.org.areaCount} areas</>}
            </span>
          </div>
        )}

        {isChurch && props.backToEstates && (
          <Link to={props.backToEstates} style={{ color: "var(--brand-200)", padding: "0 8px", fontSize: 13 }}>
            ← Back to the estate
          </Link>
        )}

        <div className="nav">
          {items.map((item) => {
            const Icon = item.icon;
            const current = item.key === props.activeSection;
            return (
              <Link key={item.key} to={base + item.path} aria-current={current ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <span>
            {props.user.name} · {roleLabel}
            {isChurch && props.apcmDate && <> · APCM {formatDate(props.apcmDate)}</>}
            {!isChurch && props.team && <> · {props.team}</>}
          </span>
          <button type="button" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </nav>

      <nav aria-label="Sections" className="tabbar">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.key} to={base + item.path} aria-current={item.key === props.activeSection ? "page" : undefined}>
              <Icon size={22} aria-hidden="true" />
              {tabLabel[item.key] ?? item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ border: 0, background: "none", font: "var(--text-xs)", color: "var(--ink-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 4px 14px", minHeight: 56, cursor: "pointer" }}
        >
          <Menu size={22} aria-hidden="true" />
          More
        </button>
      </nav>
    </>
  );
}
