import { useEffect } from "react";
import { AuthProvider, useAuth } from "./lib/auth.js";
import Nav from "./components/Nav.js";
import BottomNav from "./components/BottomNav.js";
import Landing from "./components/Landing.js";
import Login from "./components/Login.js";
import Register from "./components/Register.js";
import Profile from "./components/Profile.js";
import Cabinet from "./components/Cabinet.js";
import Admin from "./components/Admin.js";
import ApiDocs from "./components/ApiDocs.js";
import Cases from "./components/Cases.js";
import Lawyers from "./components/Lawyers.js";
import Participants from "./components/Participants.js";
import Analytics from "./components/Analytics.js";
import Methodology from "./components/Methodology.js";
import ComingSoon from "./components/ComingSoon.js";
import PrivacyPolicy from "./components/PrivacyPolicy.js";
import PageTransition from "./components/PageTransition.js";
import SeoHead from "./components/SeoHead.js";
import { useRoute, navigate, type Route } from "./components/Router.js";

const PRODUCT_SOON: Route[] = ["/cases", "/lawyers", "/participants", "/analytics", "/methodology"];

function soonHash(route: Route): string {
  const from =
    route === "/cases"
      ? "cases"
      : route === "/lawyers"
        ? "lawyers"
        : route === "/participants"
          ? "participants"
          : route === "/analytics"
            ? "analytics"
            : "";
  return from ? `/coming-soon?from=${from}` : "/coming-soon";
}

function Routes() {
  const route = useRoute();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user && PRODUCT_SOON.includes(route)) {
      window.location.hash = soonHash(route);
      return;
    }
    if ((route === "/cabinet" || route === "/admin" || route === "/profile") && !user) {
      navigate("/login");
      return;
    }
    if (route === "/admin" && user?.role !== "admin") {
      navigate("/cabinet");
      return;
    }
    if (route === "/login" && user) {
      navigate(user.profile?.firstName ? "/profile" : "/cabinet");
    }
  }, [loading, user, route]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-black">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/30">
          A2CHATSKY
        </p>
      </div>
    );
  }

  if (!user && PRODUCT_SOON.includes(route)) return null;
  if ((route === "/cabinet" || route === "/admin" || route === "/profile") && !user) return null;
  if (route === "/admin" && user?.role !== "admin") return null;
  if (route === "/login" && user) return null;

  return (
    <>
      <SeoHead route={route} />
      <Nav />
      <PageTransition route={route}>
        {route === "/" && <Landing />}
        {route === "/login" && <Login />}
        {route === "/register" && <Register />}
        {route === "/profile" && <Profile />}
        {route === "/cabinet" && <Cabinet />}
        {route === "/admin" && <Admin />}
        {route === "/api-docs" && <ApiDocs />}
        {route === "/cases" && <Cases />}
        {route === "/lawyers" && <Lawyers />}
        {route === "/participants" && <Participants />}
        {route === "/analytics" && <Analytics />}
        {route === "/methodology" && <Methodology />}
        {route === "/coming-soon" && <ComingSoon />}
        {route === "/privacy" && <PrivacyPolicy />}
      </PageTransition>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
