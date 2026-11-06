import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { ForgotPasswordPage, InvitePage, LoginPage, ResetPasswordPage } from "./pages/auth";
import { BuildingProfilePage, ChurchLayout, ComingSoon, Home, SettingsPage } from "./pages/church";
import { ComponentsPage } from "./pages/components";
import { CompliancePage } from "./pages/compliance";
import { ContractorsPage } from "./pages/contractors";
import { DashboardPage } from "./pages/dashboard";
import { DocumentsPage } from "./pages/documents";
import { JobsPage } from "./pages/jobs";
import { EstatesComingSoon, EstatesLayout, EstatesOverview } from "./pages/estates";
import { RequireSession } from "./session";

const Authed = () => (
  <RequireSession>
    <Outlet />
  </RequireSession>
);

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/invite", element: <InvitePage /> },
  { path: "/components", element: <ComponentsPage /> },
  {
    element: <Authed />,
    children: [
      { path: "/", element: <Home /> },
      {
        path: "/b/:buildingId",
        element: <ChurchLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "building", element: <BuildingProfilePage /> },
          { path: "compliance", element: <CompliancePage /> },
          { path: "quinquennial", element: <ComingSoon section="quinquennial" /> },
          { path: "jobs", element: <JobsPage /> },
          { path: "documents", element: <DocumentsPage /> },
          { path: "contractors", element: <ContractorsPage /> },
          { path: "reports", element: <ComingSoon section="reports" /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
      {
        path: "/org/:orgId",
        element: <EstatesLayout />,
        children: [
          { index: true, element: <EstatesOverview /> },
          { path: "*", element: <EstatesComingSoon /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
