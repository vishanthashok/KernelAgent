import { authEnabled, currentUser } from "@/auth";
import { Landing } from "@/components/landing/Landing";

export default async function Page() {
  return <Landing user={await currentUser()} authEnabled={authEnabled} />;
}
