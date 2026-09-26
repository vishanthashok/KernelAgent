import { authEnabled, handlers } from "@/auth";

const off = () => Response.json({ error: "sign-in is not configured on this deploy" }, { status: 404 });

export const GET = authEnabled ? handlers.GET : off;
export const POST = authEnabled ? handlers.POST : off;
