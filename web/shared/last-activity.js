const LAST_ROUTE_KEY = "tg_chess_last_route";

export function setLastRoute(route) {
  if (!route) return;
  localStorage.setItem(LAST_ROUTE_KEY, route);
}

export function getLastRoute() {
  return localStorage.getItem(LAST_ROUTE_KEY);
}
