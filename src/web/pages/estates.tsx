import { useEffect } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router";
import type { Role } from "../api";
import { useSession } from "../session";
import { Card, ErrorPanel, PageHeader } from "../ui/basics";
import { DataTable } from "../ui/data";
import { ESTATES_NAV, Sidebar, type EstatesSection } from "../ui/Sidebar";

export function EstatesLayout() {
  const { orgId = "" } = useParams();
  const location = useLocation();
  const { me, signOut } = useSession();
  const org = me.organisations.find((o) => o.id === orgId);
  const rest = location.pathname.slice(`/org/${orgId}`.length);
  const section = (ESTATES_NAV.find((n) => n.path && rest.startsWith(n.path))?.key ?? "overview") as EstatesSection;
  const buildings = me.buildings.filter((b) => b.viaEstates);

  useEffect(() => {
    document.title = [ESTATES_NAV.find((n) => n.key === section)?.label, org?.name, me.product.name].filter(Boolean).join(" · ");
  }, [section, org, me.product.name]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {org && (
        <Sidebar
          shell="estates"
          productName={me.product.name}
          tagline={me.product.tagline}
          user={{ name: me.user.name, role: org.role as Role }}
          onSignOut={signOut}
          org={{ id: org.id, name: org.name, buildingCount: buildings.length }}
          activeSection={section}
          team="Estates"
        />
      )}
      <main className="main" id="main" tabIndex={-1}>
        {org ? <Outlet /> : <ErrorPanel message="That organisation doesn't exist, or you don't have access to it." />}
      </main>
    </div>
  );
}

/** Milestone 1: the list of buildings the diocese can see. The full console is milestone 7. */
export function EstatesOverview() {
  const { orgId = "" } = useParams();
  const { me } = useSession();
  const org = me.organisations.find((o) => o.id === orgId);
  const rows = me.buildings.filter((b) => b.viaEstates).map((b) => ({ id: b.id, name: b.name, kind: b.kind }));
  return (
    <div className="stack">
      <PageHeader title="Estate overview" subtitle={org?.name} />
      <Card title="Buildings" headingId="estates-buildings" caption="Each opens the same church view a parish user sees. You can read records here but not change them.">
        <DataTable
          caption="Buildings in this estate"
          rowKey={(r) => r.id}
          rows={rows}
          emptyMessage="No parishes have been linked to this diocese yet."
          columns={[
            { key: "name", label: "Church", render: (r) => <Link to={`/b/${r.id}`}>{r.name}</Link> },
            { key: "kind", label: "Kind" },
          ]}
        />
      </Card>
      <Card>
        <p style={{ margin: 0 }}>Aggregates, the survey cycle and programmes arrive in milestone 7.</p>
      </Card>
    </div>
  );
}

export function EstatesComingSoon() {
  return (
    <div className="stack">
      <PageHeader title="Coming in milestone 7" />
      <Card>
        <p style={{ margin: 0 }}>This part of the estates console isn't built yet.</p>
      </Card>
    </div>
  );
}
