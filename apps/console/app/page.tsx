import { authEnabled, authProviders, currentUser, passwordEnabled } from "@/auth";
import { Landing } from "@/components/landing/Landing";

export default async function Page() {
  return <Landing user={await currentUser()} authEnabled={authEnabled} accounts={authEnabled && passwordEnabled} providers={authProviders} />;
}
