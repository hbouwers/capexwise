// Every table in one namespace, so `drizzle.config.ts` points at a directory
// and the migration generator sees the whole schema. One file per domain area,
// re-exported here in the order the tables depend on each other.
export * from "./organizations";
export * from "./users";
export * from "./memberships";
export * from "./invitations";
export * from "./auth";
export * from "./buildings";
export * from "./contacts";
export * from "./building-facts";
export * from "./rent-periods";
export * from "./capital-items";
export * from "./tasks";
export * from "./transactions";
export * from "./planned-work";
