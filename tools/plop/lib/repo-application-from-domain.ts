/**
 * Given `features/<name>/domain`, returns `features/<name>/application`.
 */
export function applicationPackageRelFromDomainRel(domainPackageRel: string): string {
  const suffix = "/domain";
  if (!domainPackageRel.endsWith(suffix)) {
    throw new Error(`Expected domain package path ending with /domain, got: ${domainPackageRel}`);
  }
  return `${domainPackageRel.slice(0, -suffix.length)}/application`;
}

/**
 * Given `features/<name>/application`, returns `features/<name>/domain`.
 * Repository ports always use this sibling domain (same feature slice).
 */
export function domainPackageRelFromApplicationRel(applicationPackageRel: string): string {
  const suffix = "/application";
  if (!applicationPackageRel.endsWith(suffix)) {
    throw new Error(
      `Expected application package path ending with /application, got: ${applicationPackageRel}`
    );
  }
  return `${applicationPackageRel.slice(0, -suffix.length)}/domain`;
}

/**
 * `features/plop-demo/application` → `plop-demo` (folder name of the feature).
 */
export function featureSegmentFromApplicationPackageRel(applicationPackageRel: string): string {
  const suffix = "/application";
  if (!applicationPackageRel.endsWith(suffix)) {
    throw new Error(
      `Expected application package path ending with /application, got: ${applicationPackageRel}`
    );
  }
  const base = applicationPackageRel.slice(0, -suffix.length);
  const seg = base.split("/").filter(Boolean).pop();
  if (!seg) {
    throw new Error(
      `Could not infer feature folder from application path: ${applicationPackageRel}`
    );
  }
  return seg;
}

/**
 * `features/foo/application` + `web` → `features/foo/composition/web` (repo-relative POSIX path).
 */
export function compositionPackageRelFromApplicationRel(
  applicationPackageRel: string,
  compositionAppKebab: string
): string {
  const suffix = "/application";
  if (!applicationPackageRel.endsWith(suffix)) {
    throw new Error(
      `Expected application package path ending with /application, got: ${applicationPackageRel}`
    );
  }
  const base = applicationPackageRel.slice(0, -suffix.length);
  return `${base}/composition/${compositionAppKebab}`;
}
