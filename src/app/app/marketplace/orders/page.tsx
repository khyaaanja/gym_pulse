import { redirect } from "next/navigation";

// Older notifications link here; orders live on a tab of the marketplace page.
export default function Orders() {
  redirect("/app/marketplace?tab=orders");
}
