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
import { QuinquennialPage } from "./pages/quinquennial";
import { ReportsPage } from "./pages/reports";
import { EstatesBacklog, EstatesBuildings, EstatesContractors, EstatesLayout, EstatesOverview, EstatesProgrammes, EstatesReports, EstatesSpend, EstatesSurveys, EstatesUsers } from "./pages/estates";
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
          { path: "quinquennial", element: <QuinquennialPage /> },
          { path: "jobs", element: <JobsPage /> },
          { path: "documents", element: <DocumentsPage /> },
          { path: "contractors", element: <ContractorsPage /> },
          { path: "reports", element: <ReportsPage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
      {
        path: "/org/:orgId",
        element: <EstatesLayout />,
        children: [
          { index: true, element: <EstatesOverview /> },
          { path: "buildings", element: <EstatesBuildings /> },
          { path: "surveys", element: <EstatesSurveys /> },
          { path: "backlog", element: <EstatesBacklog /> },
          { path: "programmes", element: <EstatesProgrammes /> },
          { path: "spend", element: <EstatesSpend /> },
          { path: "contractors", element: <EstatesContractors /> },
          { path: "reports", element: <EstatesReports /> },
          { path: "users", element: <EstatesUsers /> },
        ],
      },
    ],
  },
]);

// Keep the app's pages on the phone so it opens with no signal (API data is handled separately).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
