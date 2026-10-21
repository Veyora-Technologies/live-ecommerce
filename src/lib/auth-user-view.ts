/** Minimal user data safe to pass to pages and client components. Never spread a Prisma User into the client tree. */
export type CurrentUserView = {
  id: string;
  name: string;
  role: string;
  isAdmin: boolean;
  preferredArea: string | null;
  preferredLocationCode: string | null;
  theme: string;
  homeSections: string | null;
};

/** Explicitly allowlist fields so secrets and private account fields cannot leak through RSC props. */
export function toCurrentUserView(user: CurrentUserView): CurrentUserView {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    isAdmin: user.isAdmin,
    preferredArea: user.preferredArea,
    preferredLocationCode: user.preferredLocationCode,
    theme: user.theme,
    homeSections: user.homeSections,
  };
}
