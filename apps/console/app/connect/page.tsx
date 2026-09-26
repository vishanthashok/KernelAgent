import { currentUser } from "@/auth";
import { ConnectKeys } from "@/components/connect/ConnectKeys";

export const metadata = { title: "Connect your models · KernelAgent" };

export default async function ConnectPage() {
  const user = await currentUser();
  return <ConnectKeys user={user} />;
}
