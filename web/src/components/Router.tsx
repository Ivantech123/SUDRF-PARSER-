// Minimal hash router so the SPA works under static hosting without server
// rewrite rules. Routes: / /login /cabinet /admin.

import { useEffect, useState, type ReactNode } from "react";

export type Route =
  | "/"
  | "/login"
  | "/register"
  | "/profile"
  | "/cabinet"
  | "/admin"
  | "/api-docs"
  | "/cases"
  | "/lawyers"
  | "/participants"
  | "/analytics"
  | "/methodology"
  | "/coming-soon"
  | "/privacy";

function current(): Route {
  const raw = window.location.hash.replace(/^#/, "");
  const h = raw.split("?")[0];
  if (h === "/login") return "/login";
  if (h === "/register") return "/register";
  if (h === "/profile") return "/profile";
  if (h === "/cabinet") return "/cabinet";
  if (h === "/admin") return "/admin";
  if (h === "/api-docs") return "/api-docs";
  if (h === "/cases") return "/cases";
  if (h === "/lawyers") return "/lawyers";
  if (h === "/participants") return "/participants";
  if (h === "/analytics") return "/analytics";
  if (h === "/methodology") return "/methodology";
  if (h === "/coming-soon") return "/coming-soon";
  if (h === "/privacy") return "/privacy";
  return "/";
}

export function navigate(to: Route): void {
  window.location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current());
  useEffect(() => {
    const onHash = () => setRoute(current());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function Link({
  to,
  children,
  className,
}: {
  to: Route;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={() => {
        /* hashchange handles it */
      }}
    >
      {children}
    </a>
  );
}
