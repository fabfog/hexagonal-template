export { default as DataLoader } from "dataloader";
export * from "./create-data-loader-registry";
/**
 * Optional utility for long-lived/app-scoped runtimes. Request-scoped code should usually
 * stick to `createDataLoaderRegistry()` and plain `DataLoader` instances.
 */
export * from "./create-idle-data-loader";
