import { redirect } from "next/navigation";

/** The console opens straight into the analytics overview — the promo stand's
 * first screen. Auth/demo session is resolved client-side on /overview. */
export default function RootPage() {
  redirect("/overview");
}
