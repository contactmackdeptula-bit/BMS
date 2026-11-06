import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { api, ApiError, type Building, type BuildingAccess, type Role } from "../api";
import { LISTING_LABELS, ROLE_LABELS, formatDate } from "../format";
import { lastBuilding, useSession } from "../session";
import { Button, Card, ErrorPanel, Notice, PageHeader, Skeleton } from "../ui/basics";
import { DataTable } from "../ui/data";
import { Checkbox, Input, Select } from "../ui/forms";
import { CHURCH_NAV, Sidebar, type ChurchSection } from "../ui/Sidebar";

// ---------- Landing: pick the building to open ----------
export function Home() {
  const { me } = useSession();
  const parish = me.buildings.filter((b) => !b.viaEstates);
  const estatesOrg = me.organisations.find((o) => o.role === "estates" || o.role === "estates_admin");
  // Estates shell when the user is an estates role or has more than one building (UI-HANDOFF §3).
  if (estatesOrg && parish.length === 0) return <Navigate to={`/org/${estatesOrg.id}`} replace />;
  const remembered = lastBuilding.get(me.user.id);
  const target = parish.find((b) => b.id === remembered) ?? parish[0];
  if (target) return <Navigate to={`/b/${target.id}`} replace />;
  return <NoBuildings />;
}

function NoBuildings() {
  const { me, reload, signOut } = useSession();
  const adminOrg = me.organisations.find((o) => o.role === "pcc_admin");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminOrg) return;
    setBusy(true);
    try {
      await api.post(`/orgs/${adminOrg.id}/buildings`, { name, kind: "church" });
      await reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="page-title" style={{ fontSize: 22 }}>
          No buildings yet
        </h1>
        {adminOrg ? (
          <>
            <p style={{ margin: 0 }}>Add the first building for {adminOrg.name}.</p>
            {error && <ErrorPanel message={error} />}
            <form onSubmit={create}>
              <Input label="Building name" value={name} onChange={(e) => setName(e.target.value)} placeholder="St Peter and St Paul, Fareham" />
              <Button variant="primary" type="submit" loading={busy}>
                Add building
              </Button>
            </form>
          </>
        ) : (
          <p style={{ margin: 0 }}>You haven't been given access to a building yet. Ask your PCC admin to invite you.</p>
        )}
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </main>
  );
}

// ---------- Church shell ----------
type ChurchContext = { building: Building; access: BuildingAccess; reloadBuilding: () => Promise<void> };
export const useChurch = () => useOutletContext<ChurchContext>();

function sectionFromPath(pathname: string, buildingId: string): ChurchSection {
  const rest = pathname.slice(`/b/${buildingId}`.length);
  const hit = CHURCH_NAV.find((n) => n.path && rest.startsWith(n.path));
  return (hit?.key ?? "dashboard") as ChurchSection;
}

export function ChurchLayout() {
  const { buildingId = "" } = useParams();
  const location = useLocation();
  const { me, signOut } = useSession();
  const [data, setData] = useState<{ building: Building; access: BuildingAccess } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get(`/buildings/${buildingId}`));
      lastBuilding.set(me.user.id, buildingId);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [buildingId, me.user.id]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const section = sectionFromPath(location.pathname, buildingId);
  const meta = me.buildings.find((b) => b.id === buildingId);
  const org = me.organisations.find((o) => o.id === meta?.orgId);
  const role: Role = meta?.roles[0] ?? "member";
  const switchable = me.buildings.filter((b) => b.viaEstates === Boolean(meta?.viaEstates));
  const estatesOrg = me.organisations.find((o) => o.role === "estates" || o.role === "estates_admin");

  useEffect(() => {
    const label = CHURCH_NAV.find((n) => n.key === section)?.label ?? "";
    document.title = [label, data?.building.name, me.product.name].filter(Boolean).join(" · ");
  }, [section, data, me.product.name]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        shell="church"
        productName={me.product.name}
        tagline={me.product.tagline}
        user={{ name: me.user.name, role }}
        onSignOut={signOut}
        buildings={switchable.length ? switchable : [{ id: buildingId, name: data?.building.name ?? "" }]}
        activeBuildingId={buildingId}
        activeSection={section}
        apcmDate={org?.apcmDate}
        backToEstates={meta?.viaEstates && estatesOrg ? `/org/${estatesOrg.id}` : undefined}
      />
      <main className="main" id="main" tabIndex={-1}>
        {error?.status === 404 ? (
          <ErrorPanel message="That building doesn't exist, or you don't have access to it." />
        ) : error ? (
          <ErrorPanel message={error.message} onRetry={load} />
        ) : !data ? (
          <PageSkeleton />
        ) : (
          <Outlet context={{ ...data, reloadBuilding: load } satisfies ChurchContext} />
        )}
      </main>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <Skeleton height={32} width="40%" />
      <div className="grid grid-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={110} />
        ))}
      </div>
      <Skeleton height={240} />
    </div>
  );
}

// ---------- Not built yet ----------
const MILESTONE: Partial<Record<ChurchSection, string>> = {
  dashboard: "milestone 3",
  compliance: "milestone 2",
  quinquennial: "milestone 4",
  jobs: "milestone 3",
  documents: "milestone 3",
  contractors: "milestone 3",
  reports: "milestone 5",
};

export function ComingSoon({ section }: { section: ChurchSection }) {
  const { building } = useChurch();
  const label = CHURCH_NAV.find((n) => n.key === section)?.label ?? "";
  return (
    <div className="stack">
      <PageHeader title={section === "dashboard" ? building.name : label} subtitle={subtitleFor(building)} />
      <Card>
        <p style={{ margin: 0 }}>
          {label} arrives in {MILESTONE[section] ?? "a later milestone"}. For now you can fill in the{" "}
          <a href={`/b/${building.id}/building`}>building profile</a> and invite people in{" "}
          <a href={`/b/${building.id}/settings`}>Settings</a>.
        </p>
      </Card>
    </div>
  );
}

export function subtitleFor(b: Building) {
  return [b.listing ? LISTING_LABELS[b.listing] : null, b.diocese ? `Diocese of ${b.diocese.replace(/^Diocese of /, "")}` : null]
    .filter(Boolean)
    .join(" · ");
}

// ---------- Building profile ----------
const LISTING_OPTIONS = [
  { value: "", label: "Not set" },
  ...Object.entries(LISTING_LABELS).map(([value, label]) => ({ value, label })),
];
const KIND_OPTIONS = [
  { value: "church", label: "Church" },
  { value: "hall", label: "Hall" },
  { value: "house", label: "House" },
  { value: "other", label: "Other" },
];

export function BuildingProfilePage() {
  const { building, access, reloadBuilding } = useChurch();
  const [form, setForm] = useState(building);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(building), [building]);
  const set = <K extends keyof Building>(k: K, v: Building[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const readOnly = !access.canEdit;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id: _id, orgId: _org, ...body } = form;
      await api.patch(`/buildings/${building.id}`, body);
      await reloadBuilding();
      setSaved(true);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const text = (k: "name" | "diocese" | "address" | "postcode" | "inspectorName" | "insurer" | "architect", label: string, full = false) => (
    <Input
      label={label}
      className={full ? "full" : undefined}
      value={form[k] ?? ""}
      readOnly={readOnly}
      onChange={(e) => set(k, e.target.value)}
    />
  );

  return (
    <form className="stack" onSubmit={save}>
      <PageHeader
        title="Building"
        subtitle={readOnly ? "You can read this profile; churchwardens and the PCC admin can change it." : "The facts every other page uses."}
        actions={
          !readOnly && (
            <Button variant="primary" type="submit" loading={busy}>
              Save changes
            </Button>
          )
        }
      />
      {error && <ErrorPanel message={error} />}
      {saved && <Notice>Saved.</Notice>}
      <div className="grid grid-2">
        <Card title="The building" headingId="profile-building">
          <div className="form-grid">
            {text("name", "Name", true)}
            <Select label="Kind" value={form.kind} disabled={readOnly} options={KIND_OPTIONS} onChange={(e) => set("kind", e.target.value as Building["kind"])} />
            <Select
              label="Listing"
              value={form.listing ?? ""}
              disabled={readOnly}
              options={LISTING_OPTIONS}
              onChange={(e) => set("listing", e.target.value || null)}
            />
            {text("diocese", "Diocese")}
            {text("postcode", "Postcode")}
            {text("address", "Address", true)}
          </div>
          <div>
            <Checkbox label="Has a lift (adds a six-monthly lift inspection)" checked={form.hasLift} disabled={readOnly} onChange={(e) => set("hasLift", e.target.checked)} />
            <Checkbox
              label="Has a hall or water systems (adds a legionella assessment)"
              checked={form.hasWaterSystems}
              disabled={readOnly}
              onChange={(e) => set("hasWaterSystems", e.target.checked)}
            />
          </div>
        </Card>
        <Card title="People who look after it" headingId="profile-people">
          <div className="form-grid">
            {text("inspectorName", "Inspecting architect or surveyor (quinquennial)", true)}
            {text("architect", "Architect for building projects", true)}
            {text("insurer", "Insurer", true)}
          </div>
        </Card>
      </div>
    </form>
  );
}

// ---------- Settings: people and password ----------
type Member = { userId: string; name: string; email: string; role: Role; buildingId: string | null };
type Invite = { email: string; role: Role; expiresAt: string };

export function SettingsPage() {
  const { building } = useChurch();
  const { me } = useSession();
  const myRole = me.organisations.find((o) => o.id === building.orgId)?.role;
  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle={building.name} />
      {myRole === "pcc_admin" && <PeopleCard orgId={building.orgId} buildingId={building.id} />}
      <PasswordCard />
    </div>
  );
}

const INVITE_ROLES: Role[] = ["churchwarden", "treasurer", "member", "pcc_admin", "inspector"];

function PeopleCard({ orgId, buildingId }: { orgId: string; buildingId: string }) {
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("churchwarden");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/orgs/${orgId}/members`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [orgId]);
  useEffect(() => void load(), [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/orgs/${orgId}/invitations`, { email, role, buildingId: role === "inspector" ? buildingId : undefined });
      setSent(email);
      setEmail("");
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ...(data?.members ?? []).map((m) => ({ key: m.userId + m.role, name: m.name, email: m.email, role: ROLE_LABELS[m.role] ?? m.role, status: "Active" })),
    ...(data?.invites ?? []).map((i) => ({
      key: "invite-" + i.email + i.role,
      name: "",
      email: i.email,
      role: ROLE_LABELS[i.role] ?? i.role,
      status: `Invited, link valid until ${formatDate(i.expiresAt)}`,
    })),
  ];

  return (
    <Card title="People" headingId="settings-people" caption="Everyone here can see this church's records. Only PCC admins can invite.">
      {error && <ErrorPanel message={error} />}
      {sent && <Notice>Invitation sent to {sent}.</Notice>}
      <form onSubmit={invite} className="form-grid" style={{ alignItems: "end" }}>
        <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          options={INVITE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))}
        />
        <div className="full">
          <Button variant="primary" type="submit" loading={busy}>
            Send invitation
          </Button>
        </div>
      </form>
      {data ? (
        <DataTable
          caption="People with access"
          rowKey={(r) => r.key}
          rows={rows}
          columns={[
            { key: "name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "role", label: "Role", nowrap: true },
            { key: "status", label: "Status" },
          ]}
        />
      ) : (
        !error && <Skeleton height={120} />
      )}
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.post("/auth/password/change", { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Your password" headingId="settings-password" caption="Changing it signs you out on every other device.">
      {error && <ErrorPanel message={error} />}
      {done && <Notice>Password changed.</Notice>}
      <form onSubmit={save} className="form-grid" style={{ alignItems: "start" }}>
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <div className="full">
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
